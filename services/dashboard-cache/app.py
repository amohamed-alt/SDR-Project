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

APP_VERSION = "2.1.0"
DB_PATH = Path(os.getenv("DASHBOARD_CACHE_DB_PATH", "/data/dashboard-cache.sqlite3"))
MAX_PAYLOAD_BYTES = int(os.getenv("DASHBOARD_CACHE_MAX_PAYLOAD_BYTES", str(16 * 1024 * 1024)))
MAX_ENTRIES = int(os.getenv("DASHBOARD_CACHE_MAX_ENTRIES", "250"))
RETENTION_SECONDS = int(os.getenv("DASHBOARD_CACHE_RETENTION_SECONDS", str(7 * 24 * 60 * 60)))
USAGE_DATABASE_URL = os.getenv("USAGE_DATABASE_URL", "").strip()
KEY_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,96}$")
DOMAIN_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]{1,252}[a-z0-9]$")

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


class AcquisitionAccount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=300)
    source: str = Field(default="", max_length=80)
    sourceId: str = Field(default="", max_length=160)
    country: str = Field(default="", max_length=160)
    employeeCount: int = Field(default=0, ge=0, le=10_000_000)
    industry: str = Field(default="", max_length=300)
    activeJobs: int = Field(default=0, ge=0, le=1_000_000)
    headcountGrowth: float = Field(default=0, ge=-100, le=100_000)
    hrHeadcount: int = Field(default=0, ge=0, le=1_000_000)
    careerPageUrl: str = Field(default="", max_length=2000)
    detectedAts: str = Field(default="", max_length=300)
    gtmScore: int = Field(default=0, ge=0, le=100)
    gtmTier: str = Field(default="Watch", max_length=20)
    fitScore: int = Field(default=0, ge=0, le=100)
    intentScore: int = Field(default=0, ge=0, le=100)
    atsOpportunityScore: int = Field(default=0, ge=0, le=100)
    exclusionStatus: str = Field(default="eligible", max_length=30)
    exclusionReason: str = Field(default="", max_length=1000)
    hubspotCompanyId: str = Field(default="", max_length=80)
    status: str = Field(default="candidate", max_length=40)
    primaryPersona: str = Field(default="", max_length=300)
    secondaryPersona: str = Field(default="", max_length=300)
    economicBuyer: str = Field(default="", max_length=300)
    technicalInfluencer: str = Field(default="", max_length=300)
    strongestSignal: str = Field(default="", max_length=1000)
    recommendedAngle: str = Field(default="", max_length=1500)
    assignedOwnerId: str = Field(default="", max_length=80)
    assignedOwnerName: str = Field(default="", max_length=200)
    evidence: dict[str, Any] = Field(default_factory=dict)


class AcquisitionAccountsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accounts: list[AcquisitionAccount] = Field(min_length=1, max_length=500)


class AcquisitionPerson(BaseModel):
    model_config = ConfigDict(extra="forbid")
    uid: str = Field(min_length=1, max_length=160)
    accountDomain: str = Field(min_length=3, max_length=255)
    fullName: str = Field(default="", max_length=300)
    title: str = Field(default="", max_length=300)
    currentCompany: str = Field(default="", max_length=300)
    location: str = Field(default="", max_length=300)
    linkedinUrl: str = Field(default="", max_length=1200)
    rankScore: int = Field(default=0, ge=0, le=100)
    fitReason: str = Field(default="", max_length=1200)
    emails: list[str] = Field(default_factory=list, max_length=20)
    phones: list[str] = Field(default_factory=list, max_length=20)
    enrichmentStatus: str = Field(default="search_only", max_length=40)
    selected: bool = False
    meta: dict[str, Any] = Field(default_factory=dict)


class AcquisitionPeopleWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    people: list[AcquisitionPerson] = Field(min_length=1, max_length=100)


class AcquisitionPush(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accountDomain: str = Field(min_length=3, max_length=255)
    personUid: str = Field(default="", max_length=160)
    hubspotCompanyId: str = Field(default="", max_length=80)
    hubspotContactId: str = Field(default="", max_length=80)
    hubspotTaskId: str = Field(default="", max_length=80)
    ownerId: str = Field(default="", max_length=80)
    ownerName: str = Field(default="", max_length=200)
    status: str = Field(default="pushed", max_length=40)
    snapshot: dict[str, Any] = Field(default_factory=dict)


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
        raise HTTPException(status_code=503, detail="PostgreSQL data service is not configured")
    try:
        with connect(USAGE_DATABASE_URL, autocommit=True, row_factory=dict_row, connect_timeout=3) as connection:
            yield connection
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"PostgreSQL data service unavailable: {error}") from error


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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS acquisition_accounts (
                domain TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                source_id TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                employee_count INTEGER NOT NULL DEFAULT 0,
                industry TEXT NOT NULL DEFAULT '',
                active_jobs INTEGER NOT NULL DEFAULT 0,
                headcount_growth DOUBLE PRECISION NOT NULL DEFAULT 0,
                hr_headcount INTEGER NOT NULL DEFAULT 0,
                career_page_url TEXT NOT NULL DEFAULT '',
                detected_ats TEXT NOT NULL DEFAULT '',
                gtm_score INTEGER NOT NULL DEFAULT 0,
                gtm_tier TEXT NOT NULL DEFAULT 'Watch',
                fit_score INTEGER NOT NULL DEFAULT 0,
                intent_score INTEGER NOT NULL DEFAULT 0,
                ats_opportunity_score INTEGER NOT NULL DEFAULT 0,
                exclusion_status TEXT NOT NULL DEFAULT 'eligible',
                exclusion_reason TEXT NOT NULL DEFAULT '',
                hubspot_company_id TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'candidate',
                primary_persona TEXT NOT NULL DEFAULT '',
                secondary_persona TEXT NOT NULL DEFAULT '',
                economic_buyer TEXT NOT NULL DEFAULT '',
                technical_influencer TEXT NOT NULL DEFAULT '',
                strongest_signal TEXT NOT NULL DEFAULT '',
                recommended_angle TEXT NOT NULL DEFAULT '',
                assigned_owner_id TEXT NOT NULL DEFAULT '',
                assigned_owner_name TEXT NOT NULL DEFAULT '',
                evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS acquisition_people (
                uid TEXT PRIMARY KEY,
                account_domain TEXT NOT NULL REFERENCES acquisition_accounts(domain) ON DELETE CASCADE,
                full_name TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                current_company TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                linkedin_url TEXT NOT NULL DEFAULT '',
                rank_score INTEGER NOT NULL DEFAULT 0,
                fit_reason TEXT NOT NULL DEFAULT '',
                emails JSONB NOT NULL DEFAULT '[]'::jsonb,
                phones JSONB NOT NULL DEFAULT '[]'::jsonb,
                enrichment_status TEXT NOT NULL DEFAULT 'search_only',
                selected BOOLEAN NOT NULL DEFAULT FALSE,
                meta JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS acquisition_pushes (
                id BIGSERIAL PRIMARY KEY,
                account_domain TEXT NOT NULL REFERENCES acquisition_accounts(domain) ON DELETE CASCADE,
                person_uid TEXT NOT NULL DEFAULT '',
                hubspot_company_id TEXT NOT NULL DEFAULT '',
                hubspot_contact_id TEXT NOT NULL DEFAULT '',
                hubspot_task_id TEXT NOT NULL DEFAULT '',
                owner_id TEXT NOT NULL DEFAULT '',
                owner_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pushed',
                snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                pushed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_visitors_last_seen ON usage_visitors(last_seen DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_sessions_started_at ON usage_sessions(started_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_sessions_last_seen ON usage_sessions(last_seen DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_occurred_at ON usage_events(occurred_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_usage_events_feature ON usage_events(feature, occurred_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_acquisition_accounts_rank ON acquisition_accounts(exclusion_status, gtm_score DESC, active_jobs DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_acquisition_accounts_status ON acquisition_accounts(status, updated_at DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_acquisition_people_account ON acquisition_people(account_domain, rank_score DESC)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_acquisition_pushes_account ON acquisition_pushes(account_domain, pushed_at DESC)")


def validate_key(key: str) -> None:
    if not KEY_PATTERN.fullmatch(key):
        raise HTTPException(status_code=400, detail="Invalid dashboard cache key")


def validate_usage_id(value: str, label: str) -> str:
    if not ID_PATTERN.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return value


def normalize_domain(value: str) -> str:
    domain = clean_text(value, 255).lower()
    domain = re.sub(r"^https?://", "", domain).split("/")[0].split(":")[0].strip(".")
    if not DOMAIN_PATTERN.fullmatch(domain) or "." not in domain:
        raise HTTPException(status_code=400, detail="Invalid account domain")
    return domain


def clean_text(value: str, max_length: int) -> str:
    return " ".join(str(value or "").split())[:max_length]


def iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


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
            SELECT cache_key FROM dashboard_snapshots ORDER BY stored_at DESC LIMIT -1 OFFSET ?
        )
        """,
        (MAX_ENTRIES,),
    )


initialize_db()
try:
    initialize_usage_db()
except Exception as error:
    print(f"PostgreSQL initialization deferred: {error}")

app = FastAPI(title="SDR Dashboard Data API", version=APP_VERSION, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health(response: Response) -> dict[str, Any]:
    try:
        with db() as connection:
            row = connection.execute("SELECT COUNT(*) AS count, MAX(stored_at) AS newest FROM dashboard_snapshots").fetchone()
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
        "acquisitionDatabase": usage_status,
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
    path_value = clean_text(body.path or "/", 500) or "/"
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
            ON CONFLICT(visitor_id) DO UPDATE SET display_name = EXCLUDED.display_name, last_seen = NOW()
            """,
            (visitor_id, display_name),
        )
        connection.execute(
            """
            INSERT INTO usage_sessions(session_id, visitor_id, started_at, last_seen, current_path, current_feature, page_views, event_count)
            VALUES (%s, %s, NOW(), NOW(), %s, %s, %s, %s)
            ON CONFLICT(session_id) DO UPDATE SET
                last_seen = NOW(),
                ended_at = CASE WHEN %s = 'session_end' THEN NOW() ELSE usage_sessions.ended_at END,
                current_path = EXCLUDED.current_path,
                current_feature = EXCLUDED.current_feature,
                page_views = usage_sessions.page_views + EXCLUDED.page_views,
                event_count = usage_sessions.event_count + EXCLUDED.event_count
            """,
            (session_id, visitor_id, path_value, feature, page_view_increment, event_increment, event_type),
        )
        if event_type != "heartbeat":
            connection.execute(
                """
                INSERT INTO usage_events(visitor_id, session_id, event_type, path, feature, occurred_at, meta)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s)
                """,
                (visitor_id, session_id, event_type, path_value, feature, Jsonb(body.meta)),
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
                v.visitor_id, v.display_name, v.first_seen, v.last_seen,
                CASE WHEN v.last_seen >= NOW() - (%s * INTERVAL '1 second') THEN TRUE ELSE FALSE END AS active,
                latest.current_path, latest.current_feature,
                COALESCE(today.sessions_today, 0) AS sessions_today,
                COALESCE(total.total_sessions, 0) AS total_sessions,
                COALESCE(total.total_page_views, 0) AS total_page_views
            FROM usage_visitors v
            LEFT JOIN LATERAL (
                SELECT current_path, current_feature FROM usage_sessions s
                WHERE s.visitor_id = v.visitor_id ORDER BY s.last_seen DESC LIMIT 1
            ) latest ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS sessions_today FROM usage_sessions s
                WHERE s.visitor_id = v.visitor_id AND s.started_at >= CURRENT_DATE
            ) today ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS total_sessions, COALESCE(SUM(page_views), 0) AS total_page_views
                FROM usage_sessions s WHERE s.visitor_id = v.visitor_id
            ) total ON TRUE
            ORDER BY active DESC, v.last_seen DESC LIMIT %s
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
            GROUP BY feature ORDER BY events DESC, feature ASC LIMIT 12
            """
        ).fetchall()
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
            {"feature": row["feature"], "events": int(row["events"] or 0), "users": int(row["users"] or 0)}
            for row in features
        ],
    }


@app.put("/v1/acquisition/accounts")
def upsert_acquisition_accounts(body: AcquisitionAccountsWrite, response: Response) -> dict[str, Any]:
    initialize_usage_db()
    with usage_db() as connection:
        for item in body.accounts:
            domain = normalize_domain(item.domain)
            connection.execute(
                """
                INSERT INTO acquisition_accounts(
                    domain, name, source, source_id, country, employee_count, industry, active_jobs,
                    headcount_growth, hr_headcount, career_page_url, detected_ats, gtm_score, gtm_tier,
                    fit_score, intent_score, ats_opportunity_score, exclusion_status, exclusion_reason,
                    hubspot_company_id, status, primary_persona, secondary_persona, economic_buyer,
                    technical_influencer, strongest_signal, recommended_angle, assigned_owner_id,
                    assigned_owner_name, evidence, created_at, updated_at
                ) VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW()
                )
                ON CONFLICT(domain) DO UPDATE SET
                    name=EXCLUDED.name, source=EXCLUDED.source, source_id=EXCLUDED.source_id,
                    country=EXCLUDED.country, employee_count=EXCLUDED.employee_count, industry=EXCLUDED.industry,
                    active_jobs=EXCLUDED.active_jobs, headcount_growth=EXCLUDED.headcount_growth,
                    hr_headcount=EXCLUDED.hr_headcount, career_page_url=EXCLUDED.career_page_url,
                    detected_ats=EXCLUDED.detected_ats, gtm_score=EXCLUDED.gtm_score, gtm_tier=EXCLUDED.gtm_tier,
                    fit_score=EXCLUDED.fit_score, intent_score=EXCLUDED.intent_score,
                    ats_opportunity_score=EXCLUDED.ats_opportunity_score,
                    exclusion_status=EXCLUDED.exclusion_status, exclusion_reason=EXCLUDED.exclusion_reason,
                    hubspot_company_id=CASE WHEN EXCLUDED.hubspot_company_id <> '' THEN EXCLUDED.hubspot_company_id ELSE acquisition_accounts.hubspot_company_id END,
                    status=EXCLUDED.status, primary_persona=EXCLUDED.primary_persona,
                    secondary_persona=EXCLUDED.secondary_persona, economic_buyer=EXCLUDED.economic_buyer,
                    technical_influencer=EXCLUDED.technical_influencer, strongest_signal=EXCLUDED.strongest_signal,
                    recommended_angle=EXCLUDED.recommended_angle,
                    assigned_owner_id=CASE WHEN acquisition_accounts.assigned_owner_id <> '' THEN acquisition_accounts.assigned_owner_id ELSE EXCLUDED.assigned_owner_id END,
                    assigned_owner_name=CASE WHEN acquisition_accounts.assigned_owner_name <> '' THEN acquisition_accounts.assigned_owner_name ELSE EXCLUDED.assigned_owner_name END,
                    evidence=EXCLUDED.evidence, updated_at=NOW()
                """,
                (
                    domain, item.name, item.source, item.sourceId, item.country, item.employeeCount, item.industry,
                    item.activeJobs, item.headcountGrowth, item.hrHeadcount, item.careerPageUrl, item.detectedAts,
                    item.gtmScore, item.gtmTier, item.fitScore, item.intentScore, item.atsOpportunityScore,
                    item.exclusionStatus, item.exclusionReason, item.hubspotCompanyId, item.status,
                    item.primaryPersona, item.secondaryPersona, item.economicBuyer, item.technicalInfluencer,
                    item.strongestSignal, item.recommendedAngle, item.assignedOwnerId, item.assignedOwnerName,
                    Jsonb(item.evidence),
                ),
            )
    response.headers["Cache-Control"] = "no-store"
    return {"status": "stored", "accounts": len(body.accounts)}


@app.get("/v1/acquisition/accounts")
def acquisition_accounts(
    response: Response,
    limit: int = Query(default=200, ge=1, le=1000),
    status: str = Query(default="", max_length=40),
    country: str = Query(default="", max_length=160),
    tier: str = Query(default="", max_length=20),
    include_excluded: bool = Query(default=False),
) -> dict[str, Any]:
    initialize_usage_db()
    clauses: list[str] = []
    params: list[Any] = []
    if not include_excluded:
        clauses.append("exclusion_status = 'eligible'")
    if status:
        clauses.append("status = %s")
        params.append(clean_text(status, 40))
    if country:
        clauses.append("country = %s")
        params.append(clean_text(country, 160))
    if tier:
        clauses.append("gtm_tier = %s")
        params.append(clean_text(tier, 20))
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with usage_db() as connection:
        rows = connection.execute(
            f"""
            SELECT a.*,
                   COALESCE(p.people_count, 0) AS people_count,
                   COALESCE(p.enriched_count, 0) AS enriched_count,
                   COALESCE(push.push_count, 0) AS push_count
            FROM acquisition_accounts a
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS people_count,
                       COUNT(*) FILTER (WHERE enrichment_status = 'enriched') AS enriched_count
                FROM acquisition_people ap WHERE ap.account_domain = a.domain
            ) p ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS push_count FROM acquisition_pushes x WHERE x.account_domain = a.domain
            ) push ON TRUE
            {where}
            ORDER BY a.gtm_score DESC, a.intent_score DESC, a.active_jobs DESC, a.name ASC
            LIMIT %s
            """,
            (*params, limit),
        ).fetchall()
        summary = connection.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE exclusion_status='eligible') AS eligible,
                COUNT(*) FILTER (WHERE exclusion_status='eligible' AND gtm_tier='A') AS tier_a,
                COUNT(*) FILTER (WHERE exclusion_status='eligible' AND status IN ('people_ready','enriched')) AS people_ready,
                COUNT(*) FILTER (WHERE exclusion_status='eligible' AND status='enriched') AS enriched,
                COUNT(*) FILTER (WHERE status='pushed') AS pushed,
                COUNT(*) FILTER (WHERE exclusion_status<>'eligible') AS excluded
            FROM acquisition_accounts
            """
        ).fetchone() or {}

    def account_json(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "domain": row["domain"], "name": row["name"], "source": row["source"], "sourceId": row["source_id"],
            "country": row["country"], "employeeCount": int(row["employee_count"] or 0), "industry": row["industry"],
            "activeJobs": int(row["active_jobs"] or 0), "headcountGrowth": float(row["headcount_growth"] or 0),
            "hrHeadcount": int(row["hr_headcount"] or 0), "careerPageUrl": row["career_page_url"],
            "detectedAts": row["detected_ats"], "gtmScore": int(row["gtm_score"] or 0), "gtmTier": row["gtm_tier"],
            "fitScore": int(row["fit_score"] or 0), "intentScore": int(row["intent_score"] or 0),
            "atsOpportunityScore": int(row["ats_opportunity_score"] or 0), "exclusionStatus": row["exclusion_status"],
            "exclusionReason": row["exclusion_reason"], "hubspotCompanyId": row["hubspot_company_id"], "status": row["status"],
            "primaryPersona": row["primary_persona"], "secondaryPersona": row["secondary_persona"],
            "economicBuyer": row["economic_buyer"], "technicalInfluencer": row["technical_influencer"],
            "strongestSignal": row["strongest_signal"], "recommendedAngle": row["recommended_angle"],
            "assignedOwnerId": row["assigned_owner_id"], "assignedOwnerName": row["assigned_owner_name"],
            "evidence": row.get("evidence") or {}, "peopleCount": int(row.get("people_count") or 0),
            "enrichedCount": int(row.get("enriched_count") or 0), "pushCount": int(row.get("push_count") or 0),
            "createdAt": iso(row["created_at"]), "updatedAt": iso(row["updated_at"]),
        }

    response.headers["Cache-Control"] = "private, no-store, max-age=0"
    return {
        "database": "postgresql",
        "generatedAt": int(time.time() * 1000),
        "summary": {key: int(value or 0) for key, value in summary.items()},
        "accounts": [account_json(row) for row in rows],
    }


@app.put("/v1/acquisition/people")
def upsert_acquisition_people(body: AcquisitionPeopleWrite, response: Response) -> dict[str, Any]:
    initialize_usage_db()
    with usage_db() as connection:
        for person in body.people:
            domain = normalize_domain(person.accountDomain)
            connection.execute(
                """
                INSERT INTO acquisition_people(
                    uid, account_domain, full_name, title, current_company, location, linkedin_url,
                    rank_score, fit_reason, emails, phones, enrichment_status, selected, meta, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                ON CONFLICT(uid) DO UPDATE SET
                    account_domain=EXCLUDED.account_domain, full_name=EXCLUDED.full_name, title=EXCLUDED.title,
                    current_company=EXCLUDED.current_company, location=EXCLUDED.location,
                    linkedin_url=CASE WHEN EXCLUDED.linkedin_url <> '' THEN EXCLUDED.linkedin_url ELSE acquisition_people.linkedin_url END,
                    rank_score=EXCLUDED.rank_score, fit_reason=EXCLUDED.fit_reason,
                    emails=CASE WHEN jsonb_array_length(EXCLUDED.emails) > 0 THEN EXCLUDED.emails ELSE acquisition_people.emails END,
                    phones=CASE WHEN jsonb_array_length(EXCLUDED.phones) > 0 THEN EXCLUDED.phones ELSE acquisition_people.phones END,
                    enrichment_status=EXCLUDED.enrichment_status, selected=EXCLUDED.selected, meta=EXCLUDED.meta, updated_at=NOW()
                """,
                (
                    person.uid, domain, person.fullName, person.title, person.currentCompany, person.location,
                    person.linkedinUrl, person.rankScore, person.fitReason, Jsonb(person.emails), Jsonb(person.phones),
                    person.enrichmentStatus, person.selected, Jsonb(person.meta),
                ),
            )
            next_status = "enriched" if person.enrichmentStatus == "enriched" else "people_ready"
            connection.execute(
                "UPDATE acquisition_accounts SET status=CASE WHEN status='pushed' THEN status ELSE %s END, updated_at=NOW() WHERE domain=%s",
                (next_status, domain),
            )
    response.headers["Cache-Control"] = "no-store"
    return {"status": "stored", "people": len(body.people)}


@app.get("/v1/acquisition/accounts/{domain}/people")
def acquisition_people(domain: str, response: Response) -> dict[str, Any]:
    initialize_usage_db()
    normalized_domain = normalize_domain(domain)
    with usage_db() as connection:
        rows = connection.execute(
            """
            SELECT * FROM acquisition_people WHERE account_domain=%s
            ORDER BY selected DESC, rank_score DESC, updated_at DESC, full_name ASC
            """,
            (normalized_domain,),
        ).fetchall()
    response.headers["Cache-Control"] = "private, no-store, max-age=0"
    return {
        "domain": normalized_domain,
        "people": [
            {
                "uid": row["uid"], "accountDomain": row["account_domain"], "fullName": row["full_name"],
                "title": row["title"], "currentCompany": row["current_company"], "location": row["location"],
                "linkedinUrl": row["linkedin_url"], "rankScore": int(row["rank_score"] or 0),
                "fitReason": row["fit_reason"], "emails": row.get("emails") or [], "phones": row.get("phones") or [],
                "enrichmentStatus": row["enrichment_status"], "selected": bool(row["selected"]),
                "meta": row.get("meta") or {}, "updatedAt": iso(row["updated_at"]),
            }
            for row in rows
        ],
    }


@app.post("/v1/acquisition/pushes")
def write_acquisition_push(body: AcquisitionPush, response: Response) -> dict[str, Any]:
    initialize_usage_db()
    domain = normalize_domain(body.accountDomain)
    with usage_db() as connection:
        row = connection.execute(
            """
            INSERT INTO acquisition_pushes(
                account_domain, person_uid, hubspot_company_id, hubspot_contact_id, hubspot_task_id,
                owner_id, owner_name, status, snapshot, pushed_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW()) RETURNING id, pushed_at
            """,
            (
                domain, body.personUid, body.hubspotCompanyId, body.hubspotContactId, body.hubspotTaskId,
                body.ownerId, body.ownerName, body.status, Jsonb(body.snapshot),
            ),
        ).fetchone() or {}
        connection.execute(
            """
            UPDATE acquisition_accounts SET
                status=%s, hubspot_company_id=CASE WHEN %s <> '' THEN %s ELSE hubspot_company_id END,
                assigned_owner_id=CASE WHEN %s <> '' THEN %s ELSE assigned_owner_id END,
                assigned_owner_name=CASE WHEN %s <> '' THEN %s ELSE assigned_owner_name END,
                updated_at=NOW()
            WHERE domain=%s
            """,
            (
                body.status, body.hubspotCompanyId, body.hubspotCompanyId,
                body.ownerId, body.ownerId, body.ownerName, body.ownerName, domain,
            ),
        )
    response.headers["Cache-Control"] = "no-store"
    return {"status": "recorded", "id": int(row.get("id") or 0), "pushedAt": iso(row.get("pushed_at"))}
