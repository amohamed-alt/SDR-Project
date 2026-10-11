"""Sales Navigator journals. Separate namespace; never consume inventory budgets.

A pending external request is NEVER automatically retried, even after lease expiry.
An expired worker can resume only from a checkpoint with no pending side effect.
"""
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from typing import Any, Literal
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from psycopg.types.json import Jsonb
from app import app, usage_db


def initialize(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS salesnav_operations (
        operation_key TEXT PRIMARY KEY, kind TEXT NOT NULL, resource TEXT NOT NULL,
        fingerprint TEXT NOT NULL, state TEXT NOT NULL, lease TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL, result JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    connection.execute("CREATE INDEX IF NOT EXISTS salesnav_operations_resource ON salesnav_operations(resource)")
    connection.execute("""CREATE TABLE IF NOT EXISTS salesnav_company_verdicts (
        verdict_key TEXT PRIMARY KEY, verdict JSONB NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL)""")


class Claim(BaseModel):
    model_config = ConfigDict(extra='forbid')
    key: str = Field(min_length=3, max_length=500)
    kind: Literal['reveal', 'push']
    resource: str = Field(min_length=3, max_length=500)
    fingerprint: str = Field(min_length=1, max_length=100)


class Checkpoint(BaseModel):
    model_config = ConfigDict(extra='forbid')
    key: str = Field(min_length=3, max_length=500)
    lease: str = Field(min_length=1, max_length=100)
    state: Literal['running', 'completed', 'review'] = 'running'
    result: dict[str, Any] = Field(default_factory=dict)


@app.post('/v2/salesnav/claim')
def claim(body: Claim):
    with usage_db() as connection:
        initialize(connection)
        with connection.transaction():
            connection.execute('SELECT pg_advisory_xact_lock(704200251)')
            row = connection.execute('SELECT * FROM salesnav_operations WHERE operation_key=%s FOR UPDATE', (body.key,)).fetchone()
            now = datetime.now(timezone.utc)
            if row:
                if row['kind'] != body.kind or row['fingerprint'] != body.fingerprint or row['resource'] != body.resource:
                    raise HTTPException(409, 'Operation identity or assignment changed; review the original operation')
                if row['state'] == 'completed' or row['result'].get('pending') or (row['state'] == 'running' and row['expires_at'] > now):
                    return {'claimed': False, 'state': 'review' if row['result'].get('pending') else row['state'], 'result': row['result']}
            if body.kind == 'push' and not row:
                used = connection.execute("SELECT COUNT(*) AS n FROM salesnav_operations WHERE kind='push' AND resource=%s AND state='completed'", (body.resource,)).fetchone()['n']
                if used >= 2:
                    return {'claimed': False, 'state': 'company_cap', 'result': {}}
            busy = connection.execute("""SELECT operation_key FROM salesnav_operations WHERE resource=%s
                AND operation_key<>%s AND (result ? 'pending' AND result->>'pending'<>''
                OR state='running' AND expires_at>NOW()) LIMIT 1""", (body.resource, body.key)).fetchone()
            if busy:
                return {'claimed': False, 'state': 'company_busy', 'result': {}}
            lease = str(uuid4())
            expires = now + timedelta(minutes=30)
            connection.execute("""INSERT INTO salesnav_operations(operation_key,kind,resource,fingerprint,state,lease,expires_at)
                VALUES (%s,%s,%s,%s,'running',%s,%s) ON CONFLICT(operation_key) DO UPDATE SET
                state='running',lease=EXCLUDED.lease,expires_at=EXCLUDED.expires_at,updated_at=NOW()""",
                (body.key,body.kind,body.resource,body.fingerprint,lease,expires))
            return {'claimed': True, 'state': 'running', 'lease': lease, 'result': row['result'] if row else {}}


@app.post('/v2/salesnav/checkpoint')
def checkpoint(body: Checkpoint):
    with usage_db() as connection:
        initialize(connection)
        row = connection.execute("""UPDATE salesnav_operations SET result=result || %s,state=%s,updated_at=NOW()
            WHERE operation_key=%s AND lease=%s AND state='running' AND expires_at>NOW()
            RETURNING operation_key""", (Jsonb(body.result),body.state,body.key,body.lease)).fetchone()
        if not row:
            raise HTTPException(409, 'Operation lease is no longer valid; no further external writes allowed')
    return {'saved': True}


class Lookup(BaseModel):
    key: str = Field(min_length=3, max_length=500)


@app.post('/v2/salesnav/lookup')
def lookup(body: Lookup):
    with usage_db() as connection:
        initialize(connection)
        row = connection.execute('SELECT state,result FROM salesnav_operations WHERE operation_key=%s', (body.key,)).fetchone()
    return {'state': row['state'], 'result': row['result']} if row else {'state': 'missing', 'result': {}}


class Verdict(BaseModel):
    key: str = Field(min_length=3, max_length=500)
    verdict: dict[str, Any] | None = None


@app.post('/v2/salesnav/company-verdict')
def company_verdict(body: Verdict):
    with usage_db() as connection:
        initialize(connection)
        if body.verdict is not None:
            connection.execute("""INSERT INTO salesnav_company_verdicts(verdict_key,verdict,expires_at)
                VALUES(%s,%s,NOW()+INTERVAL '5 minutes') ON CONFLICT(verdict_key) DO UPDATE SET
                verdict=EXCLUDED.verdict,expires_at=EXCLUDED.expires_at""", (body.key,Jsonb(body.verdict)))
            return {'saved': True}
        row = connection.execute('SELECT verdict FROM salesnav_company_verdicts WHERE verdict_key=%s AND expires_at>NOW()', (body.key,)).fetchone()
        return {'verdict': row['verdict'] if row else None}


class States(BaseModel):
    keys: list[str] = Field(max_length=5000)


@app.post('/v2/salesnav/states')
def states(body: States):
    with usage_db() as connection:
        initialize(connection)
        rows = connection.execute('SELECT operation_key,state,result FROM salesnav_operations WHERE operation_key=ANY(%s)', (body.keys,)).fetchall()
    return {'operations': {row['operation_key']: {'state': row['state'], 'result': row['result']} for row in rows}}
