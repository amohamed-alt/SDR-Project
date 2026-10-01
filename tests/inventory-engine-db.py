"""Run against an isolated PostgreSQL DB; never against production."""
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

if os.getenv("INVENTORY_TEST_DATABASE") != "true":
    raise RuntimeError("Set INVENTORY_TEST_DATABASE=true for an isolated database")
sys.path.insert(0, "/app" if Path("/app/inventory_engine.py").exists() else str(Path(__file__).resolve().parents[1] / "services/dashboard-cache"))
from app import usage_db
import inventory_engine as engine

with usage_db() as connection:
    engine.initialize_engine(connection)

def reserve(index):
    return engine.reserve_operation(engine.Reservation(key=f"enrichment:test-{index}", kind="enrichment", dailyLimit=10))

with ThreadPoolExecutor(max_workers=20) as pool:
    results = list(pool.map(reserve, range(25)))
assert sum(result["reserved"] for result in results) == 10, results
with usage_db() as connection:
    key = connection.execute("SELECT operation_key FROM inventory_operations ORDER BY operation_key LIMIT 1").fetchone()["operation_key"]
engine.operation_result(engine.OperationResult(key=key, state="completed", result={"verified": True}))
again = engine.reserve_operation(engine.Reservation(key=key, kind="enrichment", dailyLimit=10))
assert not again["reserved"] and again["state"] == "completed" and again["result"]["verified"]
with ThreadPoolExecutor(max_workers=10) as pool:
    duplicates = list(pool.map(lambda _: engine.reserve_operation(engine.Reservation(key="pipeline:same.example", kind="pipeline", dailyLimit=10)), range(10)))
assert sum(result["reserved"] for result in duplicates) == 1
print("PASS: concurrent daily budget, durable result reuse and one company reservation")

# Recovery is allowed only once for a proven pre-reveal failure. A pending
# person charge or CRM push blocks recovery even when the saved error matches.
safe_error = "No verified matching persona found; review the company/persona before retrying"
for domain in ["recover.example", "charged.example", "pushed.example"]:
    with usage_db() as connection:
        connection.execute("INSERT INTO acquisition_accounts(domain,name) VALUES (%s,%s)", (domain, domain))
        connection.execute("INSERT INTO acquisition_people(uid,account_domain) VALUES (%s,%s)", (domain, domain))
    engine.reserve_operation(engine.Reservation(key=f"pipeline:{domain}", kind="pipeline"))
    engine.operation_result(engine.OperationResult(key=f"pipeline:{domain}", state="review", result={"error": safe_error}))
    engine.reserve_operation(engine.Reservation(key=f"company_enrichment:{domain}", kind="company_enrichment"))
    engine.operation_result(engine.OperationResult(key=f"company_enrichment:{domain}", state="completed"))
with usage_db() as connection:
    connection.execute("INSERT INTO inventory_operations(operation_key,kind) VALUES ('enrichment:charged.example','enrichment'),('push:pushed.example','push')")
assert not engine.recover_pre_reveal(engine.PreRevealRecovery(domain="charged.example"))["recovered"]
assert not engine.recover_pre_reveal(engine.PreRevealRecovery(domain="pushed.example"))["recovered"]
assert engine.recover_pre_reveal(engine.PreRevealRecovery(domain="recover.example"))["recovered"]
assert not engine.recover_pre_reveal(engine.PreRevealRecovery(domain="recover.example"))["recovered"]
with ThreadPoolExecutor(max_workers=10) as pool:
    retried = list(pool.map(lambda _: engine.reserve_operation(engine.Reservation(key="pipeline:recover.example",kind="pipeline")), range(10)))
assert sum(row["reserved"] for row in retried) == 1
engine.operation_result(engine.OperationResult(key="pipeline:recover.example",state="review",result={"error":safe_error}))
assert not engine.recover_pre_reveal(engine.PreRevealRecovery(domain="recover.example"))["recovered"]
print("PASS: one pre-reveal recovery, concurrent recovery reservation, charge/write protection")
