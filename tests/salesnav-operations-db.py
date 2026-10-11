"""Failure/restart/concurrency tests against an isolated real PostgreSQL database."""
import os
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from fastapi import HTTPException
if os.getenv('INVENTORY_TEST_DATABASE') != 'true':
    raise RuntimeError('Use an isolated test database only')
sys.path.insert(0, '/app' if Path('/app/salesnav_operations.py').exists() else str(Path(__file__).resolve().parents[1] / 'services/dashboard-cache'))
from app import usage_db
import salesnav_operations as operations

with usage_db() as connection:
    operations.initialize(connection)

def claim(key, kind='reveal', resource=None, fingerprint='fixed'):
    return operations.claim(operations.Claim(key=key,kind=kind,resource=resource or key,fingerprint=fingerprint))
def save(key, lease, result, state='running'):
    return operations.checkpoint(operations.Checkpoint(key=key,lease=lease,result=result,state=state))

# Concurrent instances can dispatch one provider request, not one per process.
with ThreadPoolExecutor(max_workers=12) as pool:
    rows=list(pool.map(lambda _:claim('reveal:concurrent'),range(12)))
assert sum(row['claimed'] for row in rows)==1, rows
lease=next(row['lease'] for row in rows if row['claimed'])
save('reveal:concurrent',lease,{'pending':'provider','creditOutcome':'unknown'},'review')
with usage_db() as connection:
    connection.execute("UPDATE salesnav_operations SET expires_at=NOW()-INTERVAL '1 day' WHERE operation_key='reveal:concurrent'")
assert not claim('reveal:concurrent')['claimed'], 'A timed-out paid call must not repeat after lease expiry'
print('PASS: cross-instance single claim and indefinite unknown-charge protection')

# A known checkpoint after creating a contact survives process restart.
row=claim('push:restart','push','company:restart.example')
save('push:restart',row['lease'],{'companyId':'company-1','contactId':'contact-1','pending':''})
with usage_db() as connection:
    connection.execute("UPDATE salesnav_operations SET expires_at=NOW()-INTERVAL '1 second' WHERE operation_key='push:restart'")
resumed=claim('push:restart','push','company:restart.example')
assert resumed['claimed'] and resumed['result']['contactId']=='contact-1'
try:
    save('push:restart',row['lease'],{'taskId':'stale-worker'})
    raise AssertionError('Stale worker must be fenced')
except HTTPException as error:
    assert error.status_code==409
save('push:restart',resumed['lease'],{'taskId':'task-1','pending':''},'completed')
assert not claim('push:restart','push','company:restart.example')['claimed']
print('PASS: checkpoint resume, old-worker fencing and completed result reuse')

# Company-level exclusion covers different people; pending writes lock the account.
first=claim('push:person-1','push','company:serial.example')
assert not claim('push:person-2','push','company:serial.example')['claimed']
save('push:person-1',first['lease'],{'pending':'task'},'review')
assert not claim('push:person-2','push','company:serial.example')['claimed']
print('PASS: different people cannot race or bypass an uncertain company write')

# No inventory kind budgets are consumed by this workflow. Per-company maximum is enforced.
for i in range(2):
    key=f'push:cap-{i}'
    row=claim(key,'push','company:cap.example')
    assert row['claimed']
    save(key,row['lease'],{'pending':''},'completed')
assert claim('push:cap-3','push','company:cap.example')['state']=='company_cap'
try:
    claim('push:restart','push','company:changed.example')
    raise AssertionError('A changed resource cannot reuse an old operation')
except HTTPException as error:
    assert error.status_code==409
print('PASS: company limit and immutable identity/resource; separate inventory namespace')
