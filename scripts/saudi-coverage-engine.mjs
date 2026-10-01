import { appendFile } from "node:fs/promises";
import { collectOfficialCareerPages } from "./inventory-career-research.mjs";
import { inventoryBuildReady } from "./inventory-build-gate.mjs";
const base = process.env.BASE_URL || "https://sdr.dashboardtalentera.tech";
const token = process.env.ACQUISITION_OWNER_TOKEN;
if (!token) throw new Error("Inventory engine authorization is missing");
async function request(path, body) {
  const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", headers: { "x-acquisition-owner-token": token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(360_000) });
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
// Only static categories may reach public Actions logs. Details stay in the app.
function failureCategory(message = "") {
  const value = String(message);
  const status = value.match(/(?:HTTP |failed \()(\d{3})/);
  if (status) return `upstream_http_${status[1]}`;
  if (/ATS result is unknown/i.test(value)) return "ats_unknown";
  if (/Apollo people|Apollo person identity/i.test(value)) return "apollo_person_source_unavailable";
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
const acquisitionDeadline = Date.now() + 70 * 60_000;
const stock = await request("/api/acquisition?allSources=1&scope=saudi200&crmPresence=new&includeExcluded=1&limit=1000");
for (let offset = 1000; offset < (stock.pagination?.filteredTotal || 0); offset += 1000) {
  stock.accounts.push(...(await request(`/api/acquisition?allSources=1&scope=saudi200&crmPresence=new&includeExcluded=1&limit=1000&offset=${offset}`)).accounts);
}
const candidates = stock.accounts.filter(a => ["eligible","review"].includes(a.exclusionStatus) && !a.domain.endsWith(".invalid") && !a.hubspotCompanyId && !a.evidence.workerCareerCheckedAt)
  .sort((a,b) => Number(b.employeeCount>=250)-Number(a.employeeCount>=250) || Number(b.employeeCount>=200)-Number(a.employeeCount>=200) || b.gtmScore-a.gtmScore || a.domain.localeCompare(b.domain));
for (const account of candidates.slice(0,100)) {
  if (Date.now() >= acquisitionDeadline) break;
  const pages = await collectOfficialCareerPages(account);
  const researched = await request("/api/lead-inventory/engine", { action: "record_career_pages", domain: account.domain, pages });
  console.log(JSON.stringify({ action: "career_research", status: researched.status, recovered: researched.recovered, pages: pages.length }));
  // POSTs are not retried. Durable reservations block uncertain external writes.
  const result = await request("/api/lead-inventory/engine", { action: "run", domain: account.domain, limit: 1, confirmCredits: true });
  pushed += result.pushed;
  review += result.results.filter((r) => r.status === "review").length;
  console.log(JSON.stringify({ action: "run", processed: result.processed, pushed: result.pushed, statuses: result.results.map((r) => r.status),
    reviewCategories: result.results.filter((r) => r.status === "review").map((r) => failureCategory(r.error)) }));
  if (result.results.some((r) => r.status === "budget_exhausted")) break;
}

for (let i = 0; i < 10; i++) {
  const result = await request("/api/lead-inventory/engine", { action: "sync", limit: 10 });
  synced += result.synced;
  if (result.synced < result.requested) historicalSyncIncomplete = true;
  console.log(JSON.stringify({ action: "sync", requested: result.requested, synced: result.synced, failed: result.requested - result.synced,
    failureCategories: result.results.filter((r) => !r.synced).map((r) => failureCategory(r.error)) }));
  if (!result.requested) break;
  if (!result.synced) { historicalSyncIncomplete = true; break; }
}
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Saudi coverage engine\n\n- Histories synced: ${synced}\n- Companies pushed: ${pushed}\n- Companies requiring review: ${review}\n- Daily ceilings: 100 company slots, 100 company enrichments, 100 identity matches and 100 phone reveals; at most 3 phone reveals per company\n- Details remain in the protected application and CRM.\n`);
console.log(JSON.stringify({ synced, pushed, review, historicalSyncIncomplete }));
if (historicalSyncIncomplete) throw new Error("Historical sync remains incomplete; independent acquisition results are retained");
