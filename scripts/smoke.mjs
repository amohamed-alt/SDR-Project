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
  const [healthResponse, dashboardResponse, calendarStatusResponse, rejectedMeetingResponse, pageResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/health`),
    fetch(`http://127.0.0.1:${port}/api/dashboard?from=2026-07-01&to=2026-07-19&ownerId=31644369`),
    fetch(`http://127.0.0.1:${port}/api/google/status`),
    fetch(`http://127.0.0.1:${port}/api/google/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    fetch(`http://127.0.0.1:${port}/`),
  ]);
  if (!healthResponse.ok || !dashboardResponse.ok || !calendarStatusResponse.ok || !pageResponse.ok) throw new Error("One or more smoke-test routes returned an error");
  const health = await healthResponse.json();
  const dashboard = await dashboardResponse.json();
  const calendarStatus = await calendarStatusResponse.json();
  const page = await pageResponse.text();
  if (health.status !== "ok") throw new Error("Health response is invalid");
  if (!dashboard.kpis || dashboard.meta?.isDemo !== true) throw new Error("Dashboard response is invalid");
  if (calendarStatus.configured !== false || calendarStatus.connected !== false) throw new Error("Calendar status response is invalid");
  if (rejectedMeetingResponse.status !== 403) throw new Error("Calendar booking origin protection is invalid");
  if (!page.includes("SDR Command Center")) throw new Error("Dashboard page markup is invalid");
  console.log("Smoke tests passed: page, health API, and dashboard API are operational.");
} finally {
  server.kill("SIGTERM");
}
