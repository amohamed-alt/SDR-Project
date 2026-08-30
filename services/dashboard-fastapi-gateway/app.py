from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials

APP_VERSION = "1.0.0"
ORIGIN_URL = os.getenv("DASHBOARD_ORIGIN_URL", "http://sdr-dashboard:3000/api/dashboard").strip()
DB_PATH = Path(os.getenv("FASTAPI_DASHBOARD_DB_PATH", "/data/dashboard-gateway.sqlite3"))
DASHBOARD_USERNAME = os.getenv("DASHBOARD_USERNAME", "talentera")
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
DEFAULT_FROM = os.getenv("NEXT_PUBLIC_DEFAULT_START_DATE", "2026-07-01")
WARM_OWNER_IDS = [value.strip() for value in os.getenv(
    "DASHBOARD_WARM_OWNER_IDS",
    "31644369,76369997,31558980",
).split(",") if value.strip()]
WARM_INTERVAL_SECONDS = max(60, int(os.getenv("DASHBOARD_WARM_INTERVAL_SECONDS", "120")))
SOFT_TTL_SECONDS = max(30, int(os.getenv("FASTAPI_DASHBOARD_SOFT_TTL_SECONDS", "120")))
ORIGIN_TIMEOUT_SECONDS = max(15, int(os.getenv("FASTAPI_DASHBOARD_ORIGIN_TIMEOUT_SECONDS", "120")))
TIMEZONE = ZoneInfo(os.getenv("HUBSPOT_TIMEZONE", "Asia/Riyadh"))

DB_PATH.parent.mkdir(parents=True, exist_ok=True)
security = HTTPBasic(auto_error=False)
_refresh_tasks: dict[str, asyncio.Task[None]] = {}


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
    with db() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS dashboard_gateway_snapshots (
                cache_key TEXT PRIMARY KEY,
                query_string TEXT NOT NULL,
                payload BLOB NOT NULL,
                content_type TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_gateway_fetched_at ON dashboard_gateway_snapshots(fetched_at DESC)"
        )


def require_auth(credentials: HTTPBasicCredentials | None) -> None:
    if not DASHBOARD_PASSWORD:
        raise HTTPException(status_code=503, detail="Dashboard authentication is not configured")
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Basic"},
        )
    username_ok = secrets.compare_digest(credentials.username.encode(), DASHBOARD_USERNAME.encode())
    password_ok = secrets.compare_digest(credentials.password.encode(), DASHBOARD_PASSWORD.encode())
    if not (username_ok and password_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid dashboard credentials",
            headers={"WWW-Authenticate": "Basic"},
        )


def canonical_query(request: Request) -> tuple[str, str]:
    items = [(key, value) for key, value in request.query_params.multi_items() if key != "refresh"]
    items.sort()
    query_string = urlencode(items, doseq=True)
    cache_key = hashlib.sha256(query_string.encode("utf-8")).hexdigest()
    return cache_key, query_string


def canonical_query_from_pairs(pairs: list[tuple[str, str]]) -> tuple[str, str]:
    sorted_pairs = sorted((key, value) for key, value in pairs if key != "refresh")
    query_string = urlencode(sorted_pairs, doseq=True)
    cache_key = hashlib.sha256(query_string.encode("utf-8")).hexdigest()
    return cache_key, query_string


def read_snapshot(cache_key: str) -> sqlite3.Row | None:
    with db() as connection:
        return connection.execute(
            "SELECT cache_key, query_string, payload, content_type, fetched_at FROM dashboard_gateway_snapshots WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()


def store_snapshot(cache_key: str, query_string: str, payload: bytes, content_type: str) -> int:
    fetched_at = int(time.time())
    with db() as connection:
        connection.execute(
            """
            INSERT INTO dashboard_gateway_snapshots(cache_key, query_string, payload, content_type, fetched_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                query_string = excluded.query_string,
                payload = excluded.payload,
                content_type = excluded.content_type,
                fetched_at = excluded.fetched_at
            """,
            (cache_key, query_string, payload, content_type, fetched_at),
        )
    return fetched_at


def response_from_snapshot(row: sqlite3.Row, cache_status: str) -> Response:
    age = max(0, int(time.time()) - int(row["fetched_at"]))
    return Response(
        content=bytes(row["payload"]),
        media_type=str(row["content_type"] or "application/json").split(";", 1)[0],
        headers={
            "Cache-Control": "private, max-age=0, must-revalidate, stale-while-revalidate=60",
            "X-Dashboard-Gateway": "fastapi",
            "X-Dashboard-Gateway-Version": APP_VERSION,
            "X-Dashboard-Gateway-Cache": cache_status,
            "X-Dashboard-Gateway-Age": str(age),
        },
    )


async def fetch_origin(query_string: str, force_refresh: bool) -> tuple[bytes, str]:
    params = query_string
    if force_refresh:
        params = f"{params}&refresh=1" if params else "refresh=1"
    url = f"{ORIGIN_URL}?{params}" if params else ORIGIN_URL
    auth = httpx.BasicAuth(DASHBOARD_USERNAME, DASHBOARD_PASSWORD)
    async with httpx.AsyncClient(timeout=ORIGIN_TIMEOUT_SECONDS, follow_redirects=False) as client:
        response = await client.get(url, auth=auth, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    if response.status_code != 200:
        detail = response.text[:500] if response.text else f"HTTP {response.status_code}"
        raise HTTPException(status_code=502, detail=f"Dashboard origin failed: {detail}")
    return response.content, response.headers.get("content-type", "application/json")


async def refresh_snapshot(cache_key: str, query_string: str, force_refresh: bool = True) -> None:
    try:
        payload, content_type = await fetch_origin(query_string, force_refresh)
        store_snapshot(cache_key, query_string, payload, content_type)
    except Exception as error:
        print(f"FastAPI dashboard refresh failed for {cache_key[:8]}: {error}")


def schedule_refresh(cache_key: str, query_string: str, force_refresh: bool = True) -> None:
    current = _refresh_tasks.get(cache_key)
    if current and not current.done():
        return

    async def runner() -> None:
        try:
            await refresh_snapshot(cache_key, query_string, force_refresh)
        finally:
            _refresh_tasks.pop(cache_key, None)

    _refresh_tasks[cache_key] = asyncio.create_task(runner())


async def warm_loop() -> None:
    await asyncio.sleep(5)
    while True:
        today = datetime.now(TIMEZONE).date().isoformat()
        for owner_id in WARM_OWNER_IDS:
            pairs = [("from", DEFAULT_FROM), ("to", today), ("ownerId", owner_id)]
            cache_key, query_string = canonical_query_from_pairs(pairs)
            try:
                payload, content_type = await fetch_origin(query_string, force_refresh=True)
                store_snapshot(cache_key, query_string, payload, content_type)
                print(f"FastAPI prewarmed owner {owner_id} through {today}")
            except Exception as error:
                print(f"FastAPI prewarm failed for owner {owner_id}: {error}")
        await asyncio.sleep(WARM_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_db()
    task = asyncio.create_task(warm_loop())
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


app = FastAPI(
    title="SDR FastAPI Dashboard Gateway",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)


@app.get("/api/dashboard")
async def dashboard(request: Request, credentials: HTTPBasicCredentials | None = None) -> Response:
    if credentials is None:
        credentials = await security(request)
    require_auth(credentials)

    cache_key, query_string = canonical_query(request)
    row = read_snapshot(cache_key)
    force_refresh = request.query_params.get("refresh") == "1"

    if row is not None:
        age = max(0, int(time.time()) - int(row["fetched_at"]))
        if force_refresh or age >= SOFT_TTL_SECONDS:
            schedule_refresh(cache_key, query_string, force_refresh=True)
        return response_from_snapshot(row, "hit" if age < SOFT_TTL_SECONDS else "stale")

    payload, content_type = await fetch_origin(query_string, force_refresh=force_refresh)
    fetched_at = store_snapshot(cache_key, query_string, payload, content_type)
    row = read_snapshot(cache_key)
    if row is None:
        return Response(content=payload, media_type="application/json")
    return response_from_snapshot(row, "miss")


@app.get("/api/dashboard-fastapi/health")
def health() -> dict[str, object]:
    initialize_db()
    with db() as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS count, MAX(fetched_at) AS newest FROM dashboard_gateway_snapshots"
        ).fetchone()
    return {
        "status": "ok",
        "gateway": "fastapi",
        "version": APP_VERSION,
        "entries": int(row["count"] if row else 0),
        "newestFetchedAt": int(row["newest"] or 0) if row else 0,
        "warmOwners": len(WARM_OWNER_IDS),
        "warmIntervalSeconds": WARM_INTERVAL_SECONDS,
        "softTtlSeconds": SOFT_TTL_SECONDS,
    }
