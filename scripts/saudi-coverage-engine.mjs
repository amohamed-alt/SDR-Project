import { appendFile } from "node:fs/promises";
import { inventoryBuildReady } from "./inventory-build-gate.mjs";
const base = process.env.BASE_URL || "https://sdr.dashboardtalentera.tech";
const token = process.env.ACQUISITION_OWNER_TOKEN;
if (!token) throw new Error("Inventory engine authorization is missing");
async function request(path, body) {
  const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", headers: { "x-acquisition-owner-token": token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${result.error || "failed"}`);
  return result;
}
let ready = false;
for (let i = 0; i < 180; i++) {
  try {
    const health = await request("/api/health");
    const report = await request("/api/lead-inventory/engine");
    if (report.version === "saudi-coverage-v1" && await inventoryBuildReady(process.env.EXPECTED_BUILD_REF, health.buildRef, process.env.GITHUB_REPOSITORY)) { ready = true; break; }
  } catch { /* Wait for the canonical deployment; never print credentials. */ }
  await new Promise((r) => setTimeout(r, 10_000));
}
if (!ready) throw new Error("Expected coverage build is not live; no provider spend or CRM writes made");
const recovery = await request("/api/lead-inventory/engine", { action: "recover_pre_reveal" });
console.log(JSON.stringify({ action: "recover_pre_reveal", recovered: recovery.recovered }));
// Only static categories may reach public Actions logs. Details stay in the app.
function failureCategory(message = "") {
  const value = String(message);
  const status = value.match(/(?:HTTP |failed \()(\d{3})/);
  if (status) return `upstream_http_${status[1]}`;
  if (/association/i.test(value)) return "association_read_incomplete";
  if (/unavailable|Some company/i.test(value)) return "crm_records_unavailable";
  if (/configured/i.test(value)) return "configuration_missing";
  if (/No verified matching persona/i.test(value)) return "matching_persona_missing";
  if (/Phone or current-employer/i.test(value)) return "phone_or_employer_unverified";
  if (/already exists in HubSpot/i.test(value)) return "existing_hubspot";
  if (/outside the Saudi/i.test(value)) return "outside_scope";
  if (/ambiguous company identity/i.test(value)) return "company_identity_review";
  if (/budget_exhausted/i.test(value)) return "daily_budget";
  if (/assignment|owner|workload/i.test(value)) return "owner_review";
  return "other_protected_error";
}
let synced = 0, pushed = 0, review = 0, historicalSyncIncomplete = false;
for (let i = 0; i < 10; i++) {
  const result = await request("/api/lead-inventory/engine", { action: "sync", limit: 10 });
  synced += result.synced;
  console.log(JSON.stringify({ action: "sync", requested: result.requested, synced: result.synced, failed: result.requested - result.synced,
    failureCategories: result.results.filter((r) => !r.synced).map((r) => failureCategory(r.error)) }));
  if (!result.requested) break;
  if (!result.synced) { historicalSyncIncomplete = true; break; }
}
for (let i = 0; i < 10; i++) {
  // POSTs are not retried. Durable reservations block uncertain external writes.
  const result = await request("/api/lead-inventory/engine", { action: "run", limit: 1, confirmCredits: true });
  pushed += result.pushed;
  review += result.results.filter((r) => r.status === "review").length;
  console.log(JSON.stringify({ action: "run", processed: result.processed, pushed: result.pushed, statuses: result.results.map((r) => r.status),
    reviewCategories: result.results.filter((r) => r.status === "review").map((r) => failureCategory(r.error)) }));
  if (!result.processed || result.results.some((r) => r.status === "budget_exhausted")) break;
}
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Saudi coverage engine\n\n- Histories synced: ${synced}\n- Companies pushed: ${pushed}\n- Companies requiring review: ${review}\n- Shared daily reveal ceiling: 10 attempts\n- Details remain in the protected application and CRM.\n`);
console.log(JSON.stringify({ synced, pushed, review, historicalSyncIncomplete }));
if (historicalSyncIncomplete) throw new Error("Historical sync remains incomplete; independent acquisition results are retained");
