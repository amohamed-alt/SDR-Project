import { appendFile, readFile } from "node:fs/promises";

const base = process.env.BASE_URL || "https://sdr.dashboardtalentera.tech";
const token = process.env.ACQUISITION_OWNER_TOKEN;
if (!token) throw new Error("Acquisition authorization is missing");
const expectedSha = process.env.EXPECTED_BUILD_REF || "";
const headers = { "x-acquisition-owner-token": token, "Content-Type": "application/json" };

async function request(path, body) {
  const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", headers,
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${String(result.error || "Request failed")}`);
  return result;
}

let ready = false;
for (let attempt = 0; attempt < 180; attempt += 1) {
  try {
    const health = await request("/api/health");
    const progress = await request("/api/lead-inventory/saudi");
    if (progress.version === "saudi-200-v2" && (!expectedSha || health.buildRef === expectedSha)) { ready = true; break; }
  } catch { /* Wait for deployment before spending. */ }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
if (!ready) throw new Error("Requested production build is not live; no Apollo calls made");

let fetched = 0, newRows = 0, existing = 0, calls = 0;
const initial = await request("/api/lead-inventory/saudi");
if (initial.rawPages.length && !initial.complete) {
  const seed = JSON.parse(await readFile("data/saudi-apollo-recovery-2026-10-01.json", "utf8"));
  for (const page of initial.rawPages) {
    const organizations = seed.pages.find(item => item.page === page)?.organizations || [];
    const result = await request("/api/lead-inventory/saudi", { page, confirmCredits: true, recoveryOrganizations: organizations });
    console.log(JSON.stringify(result));
    if (result.providerCreditsUsed) throw new Error("Recovery must not use paid calls");
  }
  for (let page = 1; page <= 500; page += 1) {
    const result = await request("/api/lead-inventory/saudi", { page, confirmCredits: true, mode: "saved_accounts" });
    console.log(JSON.stringify(result));
    if (page >= Math.max(1, result.totalPages)) break;
  }
  const repaired = await request("/api/lead-inventory/saudi");
  if (!repaired.complete) throw new Error(`Recovery incomplete: ${repaired.uniqueProviderOrganizations}/${repaired.total} source identities; paid calls disabled`);
}
for (let iteration = 0; iteration < 500; iteration += 1) {
  const progress = await request("/api/lead-inventory/saudi");
  if (progress.uncertainPages.length) throw new Error(`Uncertain paid page(s): ${progress.uncertainPages.join(",")}; manual review required`);
  if (progress.complete) break;
  if (!progress.nextPage || progress.nextPage > 500) throw new Error("Apollo display cap reached; partition discovery before more spend");
  // POST is deliberately not retried; persistent raw pages allow safe resume.
  const result = await request("/api/lead-inventory/saudi", { page: progress.nextPage, confirmCredits: true });
  fetched += result.fetched; newRows += result.newInventoryRows; existing += result.existingHubSpot; calls += result.providerCreditsUsed;
  console.log(JSON.stringify(result));
  if (result.totalPages > 500) throw new Error("Apollo display cap: universe needs partitioning; first page retained");
}
const progress = await request("/api/lead-inventory/saudi");
const inventory = await request("/api/acquisition?allSources=1&scope=saudi200&includeExcluded=1&limit=1");
console.log(JSON.stringify({ fetchedThisRun: fetched, newRowsThisRun: newRows, existingHubSpotThisRun: existing, paidCallsThisRun: calls, signalHireCreditsUsed: 0, progress, inventory: inventory.summary }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Saudi 200+ inventory\n\n- Source records: ${progress.total}\n- Completed pages: ${progress.completedPages.length}/${progress.totalPages}\n- Stored scoped companies: ${inventory.summary.total}\n- Already in HubSpot: ${inventory.summary.existing_hubspot}\n- Needs review: ${inventory.summary.review}\n- Apollo page calls this run: ${calls}\n- SignalHire credits: 0\n`);
if (!progress.complete) throw new Error("Crawl incomplete; rerun resumes from stored checkpoint");
