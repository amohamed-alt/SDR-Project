import { spawn } from "node:child_process";

const port = "3111";
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: { ...process.env, PORT: port, HOSTNAME: "127.0.0.1", DEMO_MODE: "true", DISABLE_AUTH: "true" },
  stdio: ["ignore", "pipe", "pipe"],
});

function waitForReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not become ready")), 10_000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.once("exit", (code) => reject(new Error(`Server exited before smoke tests with code ${code}`)));
  });
}

try {
  await waitForReady();
  const oversizedTaskIds = Array.from({ length: 501 }, (_, index) => String(index + 1));
  const [
    healthResponse,
    dashboardResponse,
    danielDashboardResponse,
    teamDashboardResponse,
    cacheHealthResponse,
    maqsamCallsResponse,
    rejectedMaqsamIngestResponse,
    calendarStatusResponse,
    abdullahCalendarStatusResponse,
    rejectedAvailabilityResponse,
    rejectedMeetingResponse,
    invalidCountryBatchResponse,
    emptyCountryBatchResponse,
    usageResponse,
    acquisitionOwnerGateResponse,
    pageResponse,
    maritaCallsPageResponse,
  ] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/health`),
    fetch(`http://127.0.0.1:${port}/api/dashboard?from=2026-07-01&to=2026-07-19&ownerId=31644369`),
    fetch(`http://127.0.0.1:${port}/api/dashboard?from=2026-07-01&to=2026-07-19&ownerId=37624223`),
    fetch(`http://127.0.0.1:${port}/api/dashboard/team?from=2026-07-01&to=2026-07-19`),
    fetch(`http://127.0.0.1:${port}/api/dashboard/cache-health`),
    fetch(`http://127.0.0.1:${port}/api/maqsam/calls?from=2026-07-01&to=2026-07-19`),
    fetch(`http://127.0.0.1:${port}/api/maqsam/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callKey: "smoke-test" }),
    }),
    fetch(`http://127.0.0.1:${port}/api/google/status`),
    fetch(`http://127.0.0.1:${port}/api/google/status?organizer=abdullah`),
    fetch(`http://127.0.0.1:${port}/api/google/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    fetch(`http://127.0.0.1:${port}/api/google/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    fetch(`http://127.0.0.1:${port}/api/hubspot/task-countries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: oversizedTaskIds }),
    }),
    fetch(`http://127.0.0.1:${port}/api/hubspot/task-countries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [] }),
    }),
    fetch(`http://127.0.0.1:${port}/api/usage`),
    fetch(`http://127.0.0.1:${port}/api/acquisition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "discover", pages: 1, confirmCredits: true }),
    }),
    fetch(`http://127.0.0.1:${port}/`),
    fetch(`http://127.0.0.1:${port}/marita-calls`),
  ]);

  if (!healthResponse.ok || !dashboardResponse.ok || !danielDashboardResponse.ok || !teamDashboardResponse.ok || !cacheHealthResponse.ok || !maqsamCallsResponse.ok || !calendarStatusResponse.ok || !abdullahCalendarStatusResponse.ok || !emptyCountryBatchResponse.ok || !usageResponse.ok || !pageResponse.ok || !maritaCallsPageResponse.ok) throw new Error("One or more smoke-test routes returned an error");

  const health = await healthResponse.json();
  const dashboard = await dashboardResponse.json();
  const danielDashboard = await danielDashboardResponse.json();
  const teamDashboard = await teamDashboardResponse.json();
  const cacheHealth = await cacheHealthResponse.json();
  const maqsamCalls = await maqsamCallsResponse.json();
  const calendarStatus = await calendarStatusResponse.json();
  const abdullahCalendarStatus = await abdullahCalendarStatusResponse.json();
  const invalidCountryBatch = await invalidCountryBatchResponse.json();
  const emptyCountryBatch = await emptyCountryBatchResponse.json();
  const usage = await usageResponse.json();
  const acquisitionOwnerGate = await acquisitionOwnerGateResponse.json();
  const page = await pageResponse.text();
  const maritaCallsPage = await maritaCallsPageResponse.text();

  if (health.status !== "ok") throw new Error("Health response is invalid");
  if (!dashboard.kpis || dashboard.meta?.isDemo !== true) throw new Error("Marita dashboard response is invalid");
  if (!danielDashboard.kpis || danielDashboard.meta?.isDemo !== true) throw new Error("Daniel dashboard response is invalid");
  if (String(danielDashboard.meta?.ownerId) !== "37624223") throw new Error("Daniel dashboard owner filter is invalid");
  if (!teamDashboard.marita?.kpis || !teamDashboard.daniel?.kpis) throw new Error("Dual-SDR team dashboard response is invalid");
  if (String(teamDashboard.marita.meta?.ownerId) !== "31644369" || String(teamDashboard.daniel.meta?.ownerId) !== "37624223") throw new Error("Dual-SDR team endpoint owner isolation is invalid");
  if (teamDashboardResponse.headers.get("x-dashboard-cache-version") !== "v8-dual-sdr-prewarmed") throw new Error("Dual-SDR prewarmed cache headers are missing");
  if (dashboardResponse.headers.get("x-dashboard-cache-version") !== "v7-fastapi-persistent") throw new Error("Dashboard snapshot cache headers are missing");
  if (cacheHealth.status !== "disabled" || cacheHealth.configured !== false) throw new Error("Dashboard cache health fallback is invalid in smoke mode");
  if (!Array.isArray(maqsamCalls.calls) || typeof maqsamCalls.meta?.totalStored !== "number") throw new Error("Maqsam calls response is invalid");
  if (rejectedMaqsamIngestResponse.status !== 401) throw new Error("Maqsam ingest secret protection is invalid");
  if (!dashboard.dailyActivities?.some((point) => typeof point.whatsAppMessages === "number")) throw new Error("Daily WhatsApp activity data is missing");
  if (!dashboard.recentActivities?.some((activity) => activity.type === "WhatsApp")) throw new Error("WhatsApp activity rows are missing");
  if (!danielDashboard.dailyActivities?.some((point) => typeof point.whatsAppMessages === "number")) throw new Error("Daniel WhatsApp activity data is missing");
  if (!dashboard.priorityContacts?.every((contact) => typeof contact.contactSource === "string")) throw new Error("Contact Source data is missing for motion classification");
  if (calendarStatus.configured !== false || calendarStatus.connected !== false) throw new Error("Calendar status response is invalid");
  if (abdullahCalendarStatus.configured !== false || abdullahCalendarStatus.connected !== false) throw new Error("Abdullah Calendar status response is invalid");
  if (rejectedAvailabilityResponse.status !== 403) throw new Error("Calendar availability origin protection is invalid");
  if (rejectedMeetingResponse.status !== 403) throw new Error("Calendar booking origin protection is invalid");
  if (invalidCountryBatchResponse.status !== 400 || typeof invalidCountryBatch.details !== "string") throw new Error("Task country batch validation is invalid");
  if (!Array.isArray(emptyCountryBatch.tasks) || emptyCountryBatch.tasks.length !== 0) throw new Error("Incremental task country payload is invalid");
  if (usage.tracking !== false || !Array.isArray(usage.users) || !Array.isArray(usage.topFeatures)) throw new Error("Usage analytics smoke fallback is invalid");
  if (acquisitionOwnerGateResponse.status !== 401 || !String(acquisitionOwnerGate.error || "").includes("Admin password")) throw new Error("Net-new acquisition admin password gate is not fail-closed when admin access is missing");
  if (!page.includes("SDR Command Center") || !page.includes("Inbound vs Outbound") || !page.includes("SDR Tools") || !page.includes("Marita") || !page.includes("Daniel") || !page.includes("Overview")) throw new Error("Preserved Marita dashboard or SDR switcher entries are missing");
  if (!maritaCallsPage.includes("Maqsam Call Intelligence")) throw new Error("Marita calls page is missing");

  console.log("Smoke tests passed: preserved Marita dashboard, dual-SDR owner snapshots, prewarmed team endpoint, Daniel switcher, dashboard cache health, WhatsApp data, usage endpoint, acquisition admin gate, Marita calls route, Maqsam API, organizer status, task-country caching, and protected routes are operational.");
} finally {
  server.kill("SIGTERM");
}
