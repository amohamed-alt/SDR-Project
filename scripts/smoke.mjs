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
    calendarStatusResponse,
    rejectedMeetingResponse,
    invalidCountryBatchResponse,
    emptyCountryBatchResponse,
    pageResponse,
  ] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/health`),
    fetch(`http://127.0.0.1:${port}/api/dashboard?from=2026-07-01&to=2026-07-19&ownerId=31644369`),
    fetch(`http://127.0.0.1:${port}/api/google/status`),
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
    fetch(`http://127.0.0.1:${port}/`),
  ]);
  if (!healthResponse.ok || !dashboardResponse.ok || !calendarStatusResponse.ok || !emptyCountryBatchResponse.ok || !pageResponse.ok) throw new Error("One or more smoke-test routes returned an error");
  const health = await healthResponse.json();
  const dashboard = await dashboardResponse.json();
  const calendarStatus = await calendarStatusResponse.json();
  const invalidCountryBatch = await invalidCountryBatchResponse.json();
  const emptyCountryBatch = await emptyCountryBatchResponse.json();
  const page = await pageResponse.text();
  if (health.status !== "ok") throw new Error("Health response is invalid");
  if (!dashboard.kpis || dashboard.meta?.isDemo !== true) throw new Error("Dashboard response is invalid");
  if (dashboardResponse.headers.get("x-dashboard-cache-version") !== "v6-performance") throw new Error("Dashboard snapshot cache headers are missing");
  if (!dashboard.dailyActivities?.some((point) => typeof point.whatsAppMessages === "number")) throw new Error("Daily WhatsApp activity data is missing");
  if (!dashboard.recentActivities?.some((activity) => activity.type === "WhatsApp")) throw new Error("WhatsApp activity rows are missing");
  if (!dashboard.priorityContacts?.every((contact) => typeof contact.contactSource === "string")) throw new Error("Contact Source data is missing for motion classification");
  if (calendarStatus.configured !== false || calendarStatus.connected !== false) throw new Error("Calendar status response is invalid");
  if (rejectedMeetingResponse.status !== 403) throw new Error("Calendar booking origin protection is invalid");
  if (invalidCountryBatchResponse.status !== 400 || typeof invalidCountryBatch.details !== "string") throw new Error("Task country batch validation is invalid");
  if (!Array.isArray(emptyCountryBatch.tasks) || emptyCountryBatch.tasks.length !== 0) throw new Error("Incremental task country payload is invalid");
  if (!page.includes("SDR Command Center") || !page.includes("Inbound vs Outbound")) throw new Error("Dashboard motion entry is missing");
  console.log("Smoke tests passed: dashboard snapshots, inbound/outbound entry, task-country caching, WhatsApp data, and protected routes are operational.");
} finally {
  server.kill("SIGTERM");
}
