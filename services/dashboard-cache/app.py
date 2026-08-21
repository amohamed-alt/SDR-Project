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

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

APP_VERSION = "1.0.0"
DB_PATH = Path(os.getenv("DASHBOARD_CACHE_DB_PATH", "/data/dashboard-cache.sqlite3"))
MAX_PAYLOAD_BYTES = int(os.getenv("DASHBOARD_CACHE_MAX_PAYLOAD_BYTES", str(16 * 1024 * 1024)))
MAX_ENTRIES = int(os.getenv("DASHBOARD_CACHE_MAX_ENTRIES", "250"))
RETENTION_SECONDS = int(os.getenv("DASHBOARD_CACHE_RETENTION_SECONDS", str(7 * 24 * 60 * 60)))
KEY_PATTERN = re.compile(r"^[a-f0-9]{64}$")

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


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH, timeout=5.0)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


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


def validate_key(key: str) -> None:
    if not KEY_PATTERN.fullmatch(key):
        raise HTTPException(status_code=400, detail="Invalid dashboard cache key")


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

app = FastAPI(
    title="SDR Dashboard Snapshot Cache",
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
        response.headers["Cache-Control"] = "no-store"
        return {
            "status": "ok",
            "version": APP_VERSION,
            "entries": int(row["count"] if row else 0),
            "newestStoredAt": int(row["newest"] or 0) if row else 0,
        }
    except sqlite3.Error as error:
        raise HTTPException(status_code=503, detail=f"Cache database unavailable: {error}") from error


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
