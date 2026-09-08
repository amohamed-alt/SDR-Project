const baseUrl = String(process.env.SDR_DASHBOARD_INTERNAL_URL || "http://sdr-dashboard:3000").replace(/\/$/, "");
const intervalMs = Math.max(60_000, Number(process.env.DASHBOARD_WARM_INTERVAL_MS || 300_000));
const startDelayMs = Math.max(0, Number(process.env.DASHBOARD_WARM_START_DELAY_MS || 4_000));
const timeoutMs = Math.max(5_000, Number(process.env.DASHBOARD_WARM_TIMEOUT_MS || 90_000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function warm(forceRefresh) {
  const query = forceRefresh ? "?refresh=1" : "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/api/dashboard/team${query}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": "sdr-dashboard-warmer/1.0" },
    });
    if (!response.ok) {
      throw new Error(`team warmup returned ${response.status}: ${(await response.text()).slice(0, 240)}`);
    }
    await response.arrayBuffer();
    console.log(`[dashboard-warmer] ${forceRefresh ? "refresh" : "warm"} ok in ${Date.now() - startedAt}ms`);
  } finally {
    clearTimeout(timeout);
  }
}

await sleep(startDelayMs);

let firstRun = true;
for (;;) {
  try {
    await warm(!firstRun);
  } catch (error) {
    console.error("[dashboard-warmer] warmup failed", error instanceof Error ? error.message : error);
  }
  firstRun = false;
  await sleep(intervalMs);
}
