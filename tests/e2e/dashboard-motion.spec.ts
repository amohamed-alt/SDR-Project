import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Motion mounts behind ToolAccessGate, even when dashboard reads are public.
  // Authenticate against the isolated demo's real session endpoint.
  const response = await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  expect(response.ok()).toBe(true);
  expect((await response.json()).unlocked).toBe(true);
});

test("motion reads bounded aggregates and opens matching version-pinned portfolio evidence", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_motion_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Motion QA");
    sessionStorage.setItem("sdr_v2_session_id", "session_motion_ci");
  });
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === "/api/dashboard" && new URL(response.url()).searchParams.get("profile") === "motion");
  await page.goto("/?acq=marita&view=motion&from=2026-07-01&to=2026-07-19");
  await expect(page.getByRole("button", { name: "Lock tools", exact: true })).toBeVisible();
  const response = await loaded;
  expect(response.ok()).toBe(true);
  expect(response.headers()["x-dashboard-payload"]).toBe("motion-v1");
  const summary = await response.json();
  expect(summary.meta.from).toBe("2026-07-01");
  expect(summary.meta.to).toBe("2026-07-19");
  expect(summary.priorityContacts).toBeUndefined();
  expect(summary.recentActivities).toBeUndefined();
  expect(summary.motion.outboundMetrics.contacts).toBeGreaterThan(0);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-07-01");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-07-19");
  const metric = page.locator('[data-motion="Outbound"]').getByRole("button", { name: /Portfolio contacts/ });
  await expect(metric.locator("strong")).toHaveText(String(summary.motion.outboundMetrics.contacts));
  const evidenceLoaded = page.waitForResponse(res => new URL(res.url()).pathname === "/api/dashboard/records");
  await metric.click();
  const evidenceResponse = await evidenceLoaded;
  expect(evidenceResponse.ok()).toBe(true);
  const request = new URL(evidenceResponse.url());
  expect(request.searchParams.get("version")).toBe(summary.meta.generatedAt);
  expect(request.searchParams.get("from")).toBe(summary.meta.from);
  expect(request.searchParams.get("to")).toBe(summary.meta.to);
  expect(request.searchParams.get("ownerId")).toBe(summary.meta.ownerId);
  expect(JSON.parse(request.searchParams.get("selection")!)).toEqual({ kind: "contacts", motion: "Outbound", funnel: "Portfolio" });
  const evidence = await evidenceResponse.json();
  expect(evidence.total).toBe(summary.motion.outboundMetrics.contacts);
  const drawer = page.getByRole("dialog", { name: "Outbound · portfolio contacts" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".gtm-data-count strong")).toHaveText(String(evidence.total));
  await expect(drawer.locator("tbody tr")).toHaveCount(Math.min(50, evidence.total));
  // The isolated demo has four contacts; multi-page full datasets are covered by the unit fixture.
  await expect(drawer.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
});

test("changing motion dates cancels the older request before it can overwrite the new period", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_motion_race_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Motion race QA");
    sessionStorage.setItem("sdr_v2_session_id", "session_motion_race_ci");
  });
  const seedResponse = await page.request.get("/api/dashboard?profile=motion&ownerId=31644369&from=2026-07-01&to=2026-07-19");
  expect(seedResponse.ok()).toBe(true);
  const seed = await seedResponse.json();
  let oldStarted = false;
  let releaseOld: (() => void) | undefined;
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  await page.route("**/api/dashboard?**", async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("profile") !== "motion") return route.continue();
    const from = params.get("from")!;
    if (from === "2026-07-02") { oldStarted = true; await oldGate; }
    const payload = structuredClone(seed);
    payload.meta.from = from;
    payload.motion.outboundMetrics.contacts = from === "2026-07-03" ? 33 : from === "2026-07-02" ? 22 : 4;
    await route.fulfill({ json: payload }).catch(() => { /* Aborted requests may be disposed before fulfillment. */ });
  });
  await page.goto("/?acq=marita&view=motion&from=2026-07-01&to=2026-07-19");
  await expect(page.getByRole("button", { name: "Lock tools", exact: true })).toBeVisible();
  const metric = page.locator('[data-motion="Outbound"]').getByRole("button", { name: /Portfolio contacts/ }).locator("strong");
  await expect(metric).toHaveText("4");
  await page.getByLabel("From", { exact: true }).fill("2026-07-02");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect.poll(() => oldStarted).toBe(true);
  const aborted = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).searchParams.get("profile") === "motion" && new URL(request.url()).searchParams.get("from") === "2026-07-02" });
  await page.getByLabel("From", { exact: true }).fill("2026-07-03");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await aborted;
  await expect(metric).toHaveText("33");
  releaseOld?.();
  await expect(metric).toHaveText("33");
  await expect(page.getByRole("button", { name: "Refresh data", exact: true })).toBeEnabled();
});
