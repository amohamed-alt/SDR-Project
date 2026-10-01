"""Persistent Saudi coverage and at-most-once external-operation reservations."""
from datetime import datetime, timezone
from typing import Any, Literal
from fastapi import HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from psycopg.types.json import Jsonb
from app import app, usage_db


def initialize_engine(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS inventory_coverage (
        domain TEXT PRIMARY KEY REFERENCES acquisition_accounts(domain),
        snapshot JSONB NOT NULL, observations JSONB NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    connection.execute("""CREATE TABLE IF NOT EXISTS inventory_operations (
        operation_key TEXT PRIMARY KEY, kind TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'reserved', result JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")


class CoverageWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: str = Field(min_length=3, max_length=255)
    snapshot: dict[str, Any]
    observations: list[dict[str, Any]] = Field(max_length=10000)


class Reservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=3, max_length=500)
    kind: Literal["enrichment", "pipeline", "push"]
    dailyLimit: int = Field(default=10, ge=1, le=100)


class OperationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=3, max_length=500)
    state: Literal["completed", "review"]
    result: dict[str, Any] = Field(default_factory=dict)


@app.post("/v2/inventory/reserve")
def reserve_operation(body: Reservation):
    with usage_db() as connection:
        initialize_engine(connection)
        # A transaction plus a shared advisory lock makes the daily ceiling atomic.
        with connection.transaction():
            connection.execute("SELECT pg_advisory_xact_lock(704200250)")
            existing = connection.execute("SELECT state, result FROM inventory_operations WHERE operation_key=%s", (body.key,)).fetchone()
            if existing:
                return {"reserved": False, **existing}
            day = datetime.now(timezone.utc).astimezone(__import__('zoneinfo').ZoneInfo('Asia/Riyadh')).date().isoformat()
            used = connection.execute("SELECT COUNT(*) AS n FROM inventory_operations WHERE kind=%s AND (created_at AT TIME ZONE 'Asia/Riyadh')::date=%s::date", (body.kind, day)).fetchone()["n"]
            if used >= body.dailyLimit:
                return {"reserved": False, "state": "budget_exhausted", "used": used}
            connection.execute("INSERT INTO inventory_operations(operation_key, kind) VALUES (%s,%s)", (body.key, body.kind))
            return {"reserved": True, "state": "reserved", "used": used + 1}


@app.post("/v2/inventory/operation-result")
def operation_result(body: OperationResult):
    with usage_db() as connection:
        initialize_engine(connection)
        row = connection.execute("UPDATE inventory_operations SET state=%s, result=%s WHERE operation_key=%s RETURNING operation_key", (body.state, Jsonb(body.result), body.key)).fetchone()
        if not row:
            raise HTTPException(409, "Operation was not reserved")
    return {"saved": True}


@app.put("/v2/inventory/coverage")
def write_coverage(body: CoverageWrite):
    with usage_db() as connection:
        initialize_engine(connection)
        connection.execute("""INSERT INTO inventory_coverage(domain,snapshot,observations)
            VALUES (%s,%s,%s) ON CONFLICT(domain) DO UPDATE SET
            snapshot=EXCLUDED.snapshot, observations=EXCLUDED.observations, checked_at=NOW()""",
            (body.domain, Jsonb(body.snapshot), Jsonb(body.observations)))
    return {"saved": True}


@app.get("/v2/inventory/coverage")
def read_coverage(response: Response):
    with usage_db() as connection:
        initialize_engine(connection)
        rows = connection.execute("""SELECT c.snapshot,c.observations FROM inventory_coverage c
            JOIN acquisition_accounts a ON a.domain=c.domain WHERE a.evidence->>'saudi200'='true'""").fetchall()
        operations = connection.execute("""SELECT kind,state,COUNT(*) AS count FROM inventory_operations
            WHERE created_at >= NOW()-INTERVAL '1 day' GROUP BY kind,state""").fetchall()
    response.headers["Cache-Control"] = "no-store"
    return {"snapshots": [r["snapshot"] for r in rows], "observations": [o for r in rows for o in r["observations"]], "operations": operations}


@app.get("/v2/inventory/sync-queue")
def sync_queue(limit: int = Query(default=20, ge=1, le=50)):
    with usage_db() as connection:
        initialize_engine(connection)
        rows = connection.execute("""SELECT a.domain FROM acquisition_accounts a
            LEFT JOIN inventory_coverage c ON c.domain=a.domain
            WHERE a.evidence->>'saudi200'='true' AND a.hubspot_company_id<>''
            ORDER BY c.checked_at ASC NULLS FIRST,a.domain LIMIT %s""", (limit,)).fetchall()
    return {"domains": [r["domain"] for r in rows]}


@app.get("/v2/inventory/work-queue")
def work_queue(limit: int = Query(default=100, ge=1, le=500)):
    with usage_db() as connection:
        initialize_engine(connection)
        rows = connection.execute("""SELECT a.domain FROM acquisition_accounts a
            WHERE a.evidence->>'saudi200'='true' AND a.exclusion_status='eligible'
            AND a.hubspot_company_id='' AND a.status<>'pushed' AND RIGHT(a.domain,8)<>'.invalid'
            AND NOT EXISTS(SELECT 1 FROM inventory_operations o WHERE o.operation_key='pipeline:'||a.domain)
            ORDER BY CASE WHEN a.employee_count>=250 THEN 0 WHEN a.employee_count>=200 THEN 1 ELSE 2 END,
            a.gtm_score DESC,a.domain LIMIT %s""", (limit,)).fetchall()
    return {"domains": [r["domain"] for r in rows]}
