import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_playwright_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Playwright CI");
    sessionStorage.setItem("sdr_v2_session_id", "session_playwright_ci");
  });
});

test("agent accepts the proxy's public origin and rejects external origins", async ({ request }) => {
  const headers = { origin: "https://sdr.dashboardtalentera.tech", "x-forwarded-host": "sdr.dashboardtalentera.tech", "sec-fetch-site": "same-origin" };
  const allowed = await request.post("/api/ai/sdr-agent", { headers, data: {} });
  // The demo guard is reached only after origin validation succeeds.
  expect(allowed.status()).toBe(503);
  expect((await allowed.json()).error).toContain("disabled in demo mode");
  const mismatched = await request.post("/api/ai/sdr-agent", { headers: { ...headers, origin: "https://unrelated.example" }, data: {} });
  expect(mismatched.status()).toBe(403);
  const crossSite = await request.post("/api/ai/sdr-agent", { headers: { ...headers, "sec-fetch-site": "cross-site" }, data: {} });
  expect(crossSite.status()).toBe(403);
});

test("RM charts expose source records and keep handoff scope isolated", async ({ page }) => {
  // The shared demo fixture's source activities are dated July 19.
  await page.goto("/?acq=zein&from=2026-07-01&to=2026-07-19");
  await expect(page.getByRole("heading", { name: "Activity over time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deals by stage" })).toBeVisible();
  await page.getByText("Explore daily records", { exact: true }).click();
  const recordRequest = page.waitForResponse(response => response.url().includes("/api/dashboard/records"));
  await page.getByRole("button", { name: /^2026-07-19/ }).click();
  const records = await recordRequest;
  expect(records.status()).toBe(200);
  const recordUrl = new URL(records.url());
  expect(recordUrl.searchParams.get("ownerId")).toBe("31558980");
  expect(recordUrl.searchParams.get("from")).toBe("2026-07-01");
  expect(JSON.parse(recordUrl.searchParams.get("selection")!)).toMatchObject({ kind: "activities", day: "2026-07-19" });
  expect((await records.json()).rows).toEqual([expect.objectContaining({ id: "call-1", subject: "Discovery call" })]);
  await expect(page.getByRole("dialog").getByText("Discovery call", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  let handoffUrl = "";
  await page.route("**/api/dashboard/sales-handoff?**", route => { handoffUrl = route.request().url(); return route.fulfill({ status: 503, json: { error: "No live fixture" } }); });
  await page.getByRole("button", { name: "SDR meeting handoff", exact: true }).click();
  await expect(page.getByText("No live fixture")).toBeVisible();
  expect(new URL(handoffUrl).searchParams.get("salesRepId")).toBe("31558980");
  expect(new URL(handoffUrl).searchParams.get("from")).toBe("2026-07-01");
  await page.getByLabel("Booking SDR").selectOption("daniel");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect.poll(() => new URL(handoffUrl).searchParams.get("sdr")).toBe("daniel");
});

test("studio deep links restore owner, dates, cohort and usable segment evidence", async ({ page }) => {
  await page.goto("/?acq=intelligence&studio=markets&analysisOwner=daniel&from=2026-10-01&to=2026-10-04&country=Saudi+Arabia");
  await expect(page.getByRole("heading", { name: "Target markets", exact: true })).toBeVisible();
  await expect(page.getByLabel("Reporting portfolio")).toHaveValue("daniel");
  await page.screenshot({ path: "test-results/studio-desktop.png", fullPage: true });
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-10-01");
  const response = await page.request.get("/api/dashboard/insights?ownerId=37624223&from=2026-10-01&to=2026-10-04");
  const body = await response.json();
  expect(body.dashboard.priorityContacts).toHaveLength(0);
  expect(body.insights.quality.total).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Talent market watch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Market news watch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask SDR Agent", exact: true })).toHaveCount(0);
  await expect(page.getByText("News search is disabled for demo data.")).toBeVisible();
});

test("narrow analytics has accessible navigation and no page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?acq=intelligence&studio=executive&from=2026-10-01&to=2026-10-04");
  await expect(page.getByRole("heading", { name: "Where to focus next" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zein Talentera", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/studio-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Tool studio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose the outcome you need." })).toBeVisible();
  await page.getByRole("button", { name: "Open Call intelligence" }).click();
  await expect(page).toHaveURL(/view=maqsam/);
  await expect(page).toHaveURL(/from=2026-10-01/);
});

 test("call audience drilldowns preserve exact source scope and date shortcuts", async ({ page }) => {
  await page.goto("/?acq=intelligence&studio=executive&from=2026-07-01&to=2026-07-19");
  await expect(page.getByRole("heading", { name: "Who are we actually calling?" })).toBeVisible();
  await page.getByRole("button", { name: "People", exact: true }).click();
  await expect(page.getByRole("heading", { name: "People we call most" })).toBeVisible();
  const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "With meeting", exact: true }) });
  const response = page.waitForResponse(r => r.url().includes("/api/dashboard/records"));
  await table.getByRole("button").first().click();
  const records = await response;
  expect(records.status()).toBe(200);
  expect((await records.json()).rows.map((row: { id: string }) => row.id)).toEqual(["call-1"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const from = await page.getByLabel("From", { exact: true }).inputValue();
  expect(await page.getByLabel("To", { exact: true }).inputValue()).toBe(from);
  await expect(page).toHaveURL(new RegExp(`from=${from}`));
});
