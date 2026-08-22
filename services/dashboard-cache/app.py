from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from psycopg import Connection, connect
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

APP_VERSION = "2.0.0"
DB_PATH = Path(os.getenv("DASHBOARD_CACHE_DB_PATH", "/data/dashboard-cache.sqlite3"))
MAX_PAYLOAD_BYTES = int(os.getenv("DASHBOARD_CACHE_MAX_PAYLOAD_BYTES", str(16 * 1024 * 1024)))
MAX_ENTRIES = int(os.getenv("DASHBOARD_CACHE_MAX_ENTRIES", "250"))
RETENTION_SECONDS = int(os.getenv("DASHBOARD_CACHE_RETENTION_SECONDS", str(7 * 24 * 60 * 60)))
USAGE_DATABASE_URL = os.getenv("USAGE_DATABASE_URL", "").strip()
KEY_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,96}$")

DB_PATH.parent.mkdir(parents=True, exist_ok=True)
_db_lock = Lock()


class SnapshotWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=64, max_length=64)
    refreshedAt: int = Field(gt=0)
    data: dict[str, Any]


class SnapshotRead(BaseModel):
    key: str
    refreshedAt: int
    storedAt: int
    ageSeconds: int
    data: dict[str, Any]


class UsageEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visitorId: str = Field(min_length=8, max_length=96)
    sessionId: str = Field(min_length=8, max_length=96)
    displayName: str = Field(min_length=1, max_length=80)
    eventType: str = Field(min_length=1, max_length=80)
    path: str = Field(default="/", max_length=500)
    feature: str = Field(default="dashboard", max_length=120)
    meta: dict[str, Any] = Field(default_factory=dict)


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH, timeout=5.0)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


@contextmanager
def usage_db() -> Iterator[Connection[dict[str, Any]]]:
    if not USAGE_DATABASE_URL:
        raise HTTPException(status_code=503, detail="Usage PostgreSQL is not configured")
    try:
        with connect(USAGE_DATABASE_URL, autocommit=True, row_factory=dict_row, connect_timeout=3) as connection:
            yield connection
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Usage PostgreSQL unavailable: {error}") from error


def initialize_db() -> None:
    with _db_lock, db() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS dashboard_snapshots (
                cache_key TEXT PRIMARY KEY,
                refreshed_at INTEGER NOT NULL,
                stored_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_stored_at ON dashboard_snapshots(stored_at DESC)"
        )


def initialize_usage_db() -> None:
    if not USAGE_DATABASE_URL:
        return
    with usage_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS usage_visitors (
                visitor_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS usage_sessions (
                session_id TEXT PRIMARY KEY,
                visitor_id TEXT NOT NULL REFERENCES usage_visitors(visitor_id) ON DELETE CASCADE,
                started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ended_at TIMESTAMPTZ,
                current_path TEXT NOT NULL DEFAULT '/',
                current_feature TEXT NOT NULL DEFAULT 'dashboard',
                page_views INTEGER NOT NULL DEFAULT 0,
                event_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS usage_events (
                id BIGSERIAL PRIMARY KEY,
                visitor_id TEXT NOT NULL REFERENCES usage_visitors(visitor_id) ON DELETE CASCADE,
                session_id TEXT NOT NULL REFERENCES usage_sessions(session_id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                path TEXT NOT NULL DEFAULT '/',
                feature TEXT NOT NULL DEFAULT 'dashboard',
                occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                meta JSONB NOT NULL DEFAULT '{}'::jsonb
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_visitors_last_seen ON usage_visitors(last_seen DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_sessions_started_at ON usage_sessions(started_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_sessions_last_seen ON usage_sessions(last_seen DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_occurred_at ON usage_events(occurred_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_feature ON usage_events(feature, occurred_at DESC)")


def validate_key(key: str) -> None:
    if not KEY_PATTERN.fullmatch(key):
        raise HTTPException(status_code=400, detail="Invalid dashboard cache key")


def validate_usage_id(value: str, label: str) -> str:
    if not ID_PATTERN.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return value


def clean_text(value: str, max_length: int) -> str:
    return " ".join(str(value or "").split())[:max_length]


def serialize_payload(data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    size = len(payload.encode("utf-8"))
    if size > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Dashboard snapshot exceeds {MAX_PAYLOAD_BYTES} bytes")
    return payload


def prune(connection: sqlite3.Connection, now: int) -> None:
    retention_floor = now - RETENTION_SECONDS
    connection.execute("DELETE FROM dashboard_snapshots WHERE stored_at < ?", (retention_floor,))
    connection.execute(
        """
        DELETE FROM dashboard_snapshots
        WHERE cache_key IN (
            SELECT cache_key
            FROM dashboard_snapshots
            ORDER BY stored_at DESC
            LIMIT -1 OFFSET ?
        )
        """,
        (MAX_ENTRIES,),
    )


initialize_db()
try:
    initialize_usage_db()
except Exception as error:
    # Keep the hot dashboard cache online even if analytics storage is temporarily unavailable.
    print(f"Usage PostgreSQL initialization deferred: {error}")

app = FastAPI(
    title="SDR Dashboard Data API",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/health")
def health(response: Response) -> dict[str, Any]:
    try:
        with db() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count, MAX(stored_at) AS newest FROM dashboard_snapshots"
            ).fetchone()
    except sqlite3.Error as error:
        raise HTTPException(status_code=503, detail=f"Cache database unavailable: {error}") from error

    usage_status = "disabled"
    if USAGE_DATABASE_URL:
        try:
            initialize_usage_db()
            with usage_db() as connection:
                connection.execute("SELECT 1").fetchone()
            usage_status = "ok"
        except Exception:
            usage_status = "unavailable"

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "ok",
        "version": APP_VERSION,
        "entries": int(row["count"] if row else 0),
        "newestStoredAt": int(row["newest"] or 0) if row else 0,
        "usageDatabase": usage_status,
    }


@app.get("/v1/dashboard/{key}", response_model=SnapshotRead)
def read_dashboard_snapshot(key: str, response: Response) -> SnapshotRead:
    validate_key(key)
    with db() as connection:
        row = connection.execute(
            "SELECT cache_key, refreshed_at, stored_at, payload FROM dashboard_snapshots WHERE cache_key = ?",
            (key,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Dashboard snapshot not found")

    now_ms = int(time.time() * 1000)
    refreshed_at = int(row["refreshed_at"])
    response.headers["Cache-Control"] = "private, no-store, max-age=0"
    return SnapshotRead(
        key=key,
        refreshedAt=refreshed_at,
        storedAt=int(row["stored_at"]),
        ageSeconds=max(0, round((now_ms - refreshed_at) / 1000)),
        data=json.loads(row["payload"]),
    )


@app.put("/v1/dashboard/{key}")
def write_dashboard_snapshot(key: str, body: SnapshotWrite, response: Response) -> dict[str, Any]:
    validate_key(key)
    if body.key != key:
        raise HTTPException(status_code=400, detail="Cache key mismatch")

    payload = serialize_payload(body.data)
    stored_at = int(time.time() * 1000)

    with _db_lock, db() as connection:
        connection.execute(
            """
            INSERT INTO dashboard_snapshots(cache_key, refreshed_at, stored_at, payload)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                refreshed_at = excluded.refreshed_at,
                stored_at = excluded.stored_at,
                payload = excluded.payload
            """,
            (key, body.refreshedAt, stored_at, payload),
        )
        prune(connection, stored_at)

    response.headers["Cache-Control"] = "no-store"
    return {"status": "stored", "key": key, "storedAt": stored_at}


@app.delete("/v1/dashboard/{key}")
def delete_dashboard_snapshot(key: str, response: Response) -> dict[str, Any]:
    validate_key(key)
    with _db_lock, db() as connection:
        cursor = connection.execute("DELETE FROM dashboard_snapshots WHERE cache_key = ?", (key,))
    response.headers["Cache-Control"] = "no-store"
    return {"status": "deleted", "key": key, "deleted": cursor.rowcount > 0}


@app.get("/v1/stats")
def stats(response: Response) -> dict[str, Any]:
    with db() as connection:
        rows = connection.execute(
            "SELECT refreshed_at, stored_at, LENGTH(payload) AS bytes FROM dashboard_snapshots ORDER BY stored_at DESC"
        ).fetchall()

    now_ms = int(time.time() * 1000)
    total_bytes = sum(int(row["bytes"] or 0) for row in rows)
    response.headers["Cache-Control"] = "no-store"
    return {
        "version": APP_VERSION,
        "entries": len(rows),
        "payloadBytes": total_bytes,
        "newestAgeSeconds": max(0, round((now_ms - int(rows[0]["refreshed_at"])) / 1000)) if rows else None,
        "oldestAgeSeconds": max(0, round((now_ms - int(rows[-1]["refreshed_at"])) / 1000)) if rows else None,
    }


@app.post("/v1/usage/events")
def write_usage_event(body: UsageEvent, response: Response) -> dict[str, Any]:
    initialize_usage_db()
    visitor_id = validate_usage_id(body.visitorId, "visitor id")
    session_id = validate_usage_id(body.sessionId, "session id")
    display_name = clean_text(body.displayName, 80)
    event_type = clean_text(body.eventType, 80).lower().replace(" ", "_")
    path = clean_text(body.path or "/", 500) or "/"
    feature = clean_text(body.feature or "dashboard", 120) or "dashboard"
    if not display_name:
        raise HTTPException(status_code=400, detail="Display name is required")

    page_view_increment = 1 if event_type == "page_view" else 0
    event_increment = 0 if event_type == "heartbeat" else 1

    with usage_db() as connection:
        connection.execute(
            """
            INSERT INTO usage_visitors(visitor_id, display_name, first_seen, last_seen)
            VALUES (%s, %s, NOW(), NOW())
            ON CONFLICT(visitor_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                last_seen = NOW()
            """,
            (visitor_id, display_name),
        )
        connection.execute(
            """
            INSERT INTO usage_sessions(
                session_id, visitor_id, started_at, last_seen, current_path, current_feature, page_views, event_count
            )
            VALUES (%s, %s, NOW(), NOW(), %s, %s, %s, %s)
            ON CONFLICT(session_id) DO UPDATE SET
                last_seen = NOW(),
                ended_at = CASE WHEN %s = 'session_end' THEN NOW() ELSE usage_sessions.ended_at END,
                current_path = EXCLUDED.current_path,
                current_feature = EXCLUDED.current_feature,
                page_views = usage_sessions.page_views + EXCLUDED.page_views,
                event_count = usage_sessions.event_count + EXCLUDED.event_count
            """,
            (
                session_id,
                visitor_id,
                path,
                feature,
                page_view_increment,
                event_increment,
                event_type,
            ),
        )
        if event_type != "heartbeat":
            connection.execute(
                """
                INSERT INTO usage_events(visitor_id, session_id, event_type, path, feature, occurred_at, meta)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s)
                """,
                (visitor_id, session_id, event_type, path, feature, Jsonb(body.meta)),
            )

    response.headers["Cache-Control"] = "no-store"
    return {"status": "recorded", "tracking": True}


@app.get("/v1/usage/summary")
def usage_summary(
    response: Response,
    active_seconds: int = Query(default=120, ge=30, le=900),
    user_limit: int = Query(default=100, ge=1, le=250),
) -> dict[str, Any]:
    initialize_usage_db()
    with usage_db() as connection:
        metrics = connection.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM usage_visitors WHERE last_seen >= NOW() - (%s * INTERVAL '1 second')) AS active_now,
                (SELECT COUNT(DISTINCT visitor_id) FROM usage_sessions WHERE started_at >= CURRENT_DATE) AS unique_users_today,
                (SELECT COUNT(*) FROM usage_sessions WHERE started_at >= CURRENT_DATE) AS sessions_today,
                (SELECT COUNT(*) FROM usage_events WHERE event_type = 'session_start' AND occurred_at >= CURRENT_DATE) AS opens_today,
                (SELECT COUNT(*) FROM usage_events WHERE occurred_at >= CURRENT_DATE) AS events_today,
                (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (last_seen - started_at)) / 60.0), 0)
                   FROM usage_sessions WHERE started_at >= CURRENT_DATE) AS avg_session_minutes
            """,
            (active_seconds,),
        ).fetchone() or {}

        users = connection.execute(
            """
            SELECT
                v.visitor_id,
                v.display_name,
                v.first_seen,
                v.last_seen,
                CASE WHEN v.last_seen >= NOW() - (%s * INTERVAL '1 second') THEN TRUE ELSE FALSE END AS active,
                latest.current_path,
                latest.current_feature,
                COALESCE(today.sessions_today, 0) AS sessions_today,
                COALESCE(total.total_sessions, 0) AS total_sessions,
                COALESCE(total.total_page_views, 0) AS total_page_views
            FROM usage_visitors v
            LEFT JOIN LATERAL (
                SELECT current_path, current_feature
                FROM usage_sessions s
                WHERE s.visitor_id = v.visitor_id
                ORDER BY s.last_seen DESC
                LIMIT 1
            ) latest ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS sessions_today
                FROM usage_sessions s
                WHERE s.visitor_id = v.visitor_id AND s.started_at >= CURRENT_DATE
            ) today ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS total_sessions, COALESCE(SUM(page_views), 0) AS total_page_views
                FROM usage_sessions s
                WHERE s.visitor_id = v.visitor_id
            ) total ON TRUE
            ORDER BY active DESC, v.last_seen DESC
            LIMIT %s
            """,
            (active_seconds, user_limit),
        ).fetchall()

        features = connection.execute(
            """
            SELECT feature, COUNT(*) AS events, COUNT(DISTINCT visitor_id) AS users
            FROM usage_events
            WHERE occurred_at >= NOW() - INTERVAL '30 days'
              AND feature <> ''
              AND event_type IN ('page_view', 'feature_open', 'tool_open', 'action')
            GROUP BY feature
            ORDER BY events DESC, feature ASC
            LIMIT 12
            """
        ).fetchall()

    def iso(value: Any) -> Any:
        return value.isoformat() if hasattr(value, "isoformat") else value

    response.headers["Cache-Control"] = "private, no-store, max-age=0"
    return {
        "tracking": True,
        "database": "postgresql",
        "activeWindowSeconds": active_seconds,
        "generatedAt": int(time.time() * 1000),
        "metrics": {
            "activeNow": int(metrics.get("active_now") or 0),
            "uniqueUsersToday": int(metrics.get("unique_users_today") or 0),
            "sessionsToday": int(metrics.get("sessions_today") or 0),
            "opensToday": int(metrics.get("opens_today") or 0),
            "eventsToday": int(metrics.get("events_today") or 0),
            "avgSessionMinutes": round(float(metrics.get("avg_session_minutes") or 0), 1),
        },
        "users": [
            {
                "visitorId": row["visitor_id"],
                "displayName": row["display_name"],
                "firstSeen": iso(row["first_seen"]),
                "lastSeen": iso(row["last_seen"]),
                "active": bool(row["active"]),
                "currentPath": row.get("current_path") or "/",
                "currentFeature": row.get("current_feature") or "dashboard",
                "sessionsToday": int(row.get("sessions_today") or 0),
                "totalSessions": int(row.get("total_sessions") or 0),
                "totalPageViews": int(row.get("total_page_views") or 0),
            }
            for row in users
        ],
        "topFeatures": [
            {
                "feature": row["feature"],
                "events": int(row["events"] or 0),
                "users": int(row["users"] or 0),
            }
            for row in features
        ],
    }
