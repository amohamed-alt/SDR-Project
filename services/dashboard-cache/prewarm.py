from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DB_PATH = Path(os.getenv("DASHBOARD_CACHE_DB_PATH", "/data/dashboard-cache.sqlite3"))
ORIGIN_URL = os.getenv("DASHBOARD_PREWARM_ORIGIN_URL", "http://sdr-dashboard:3000/api/dashboard").rstrip("/")
OWNER_IDS = [
    value.strip()
    for value in os.getenv("DASHBOARD_PREWARM_OWNER_IDS", "31644369,76369997,31558980").split(",")
    if value.strip()
]
INTERVAL_SECONDS = max(60, int(os.getenv("DASHBOARD_PREWARM_INTERVAL_SECONDS", "300")))
REQUEST_TIMEOUT_SECONDS = max(30, int(os.getenv("DASHBOARD_PREWARM_TIMEOUT_SECONDS", "180")))
TIMEZONE = ZoneInfo(os.getenv("HUBSPOT_TIMEZONE", "Asia/Riyadh"))


def default_period() -> tuple[str, str]:
    now = datetime.now(TIMEZONE)
    return now.replace(day=1).date().isoformat(), now.date().isoformat()


def canonical_filters(from_date: str, to_date: str, owner_id: str) -> dict[str, str]:
    # Keep this field order identical to src/lib/dashboard-cache-api.ts.
    return {
        "from": from_date,
        "to": to_date,
        "ownerId": owner_id,
        "country": "",
        "originalSource": "",
        "latestSource": "",
        "tier": "",
        "persona": "",
    }


def cache_key(filters: dict[str, str]) -> str:
    canonical = json.dumps(filters, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def generated_at_ms(data: dict[str, object]) -> int:
    try:
        meta = data.get("meta")
        generated = meta.get("generatedAt") if isinstance(meta, dict) else None
        if isinstance(generated, str) and generated:
            parsed = datetime.fromisoformat(generated.replace("Z", "+00:00"))
            return int(parsed.timestamp() * 1000)
    except (TypeError, ValueError):
        pass
    return int(time.time() * 1000)


def valid_dashboard(data: object) -> bool:
    if not isinstance(data, dict):
        return False
    return all(key in data for key in ("kpis", "meta", "dailyActivities", "recentActivities"))


def store_snapshot(key: str, data: dict[str, object]) -> None:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    refreshed_at = generated_at_ms(data)
    stored_at = int(time.time() * 1000)
    with sqlite3.connect(DB_PATH, timeout=5.0) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            INSERT INTO dashboard_snapshots(cache_key, refreshed_at, stored_at, payload)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                refreshed_at = excluded.refreshed_at,
                stored_at = excluded.stored_at,
                payload = excluded.payload
            """,
            (key, refreshed_at, stored_at, payload),
        )
        connection.commit()


def warm_owner(owner_id: str, from_date: str, to_date: str) -> None:
    filters = canonical_filters(from_date, to_date, owner_id)
    query = urllib.parse.urlencode({
        "from": from_date,
        "to": to_date,
        "ownerId": owner_id,
        "refresh": "1",
    })
    request = urllib.request.Request(
        f"{ORIGIN_URL}?{query}",
        headers={"Accept": "application/json", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"origin returned HTTP {response.status}")
        data = json.loads(response.read().decode("utf-8"))
    if not valid_dashboard(data):
        raise RuntimeError("origin response shape does not match DashboardData")
    store_snapshot(cache_key(filters), data)
    print(f"FastAPI prewarmed owner {owner_id} ({from_date} -> {to_date})", flush=True)


def run_forever() -> None:
    # dashboard-cache-api starts before sdr-dashboard; allow the origin to boot,
    # then retry independently without affecting FastAPI health/read availability.
    time.sleep(12)
    while True:
        from_date, to_date = default_period()
        for owner_id in OWNER_IDS:
            try:
                warm_owner(owner_id, from_date, to_date)
            except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError, sqlite3.Error) as error:
                print(f"FastAPI prewarm failed for owner {owner_id}: {error}", flush=True)
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    run_forever()
