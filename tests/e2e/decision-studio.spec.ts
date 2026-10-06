import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_playwright_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Playwright CI");
    sessionStorage.setItem("sdr_v2_session_id", "session_playwright_ci");
  });
});

test("RM charts expose source records and keep handoff scope isolated", async ({ page }) => {
  await page.goto("/?acq=zein&from=2026-10-01&to=2026-10-04");
  await expect(page.getByRole("heading", { name: "Activity over time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deals by stage" })).toBeVisible();
  await page.getByText("Explore daily records", { exact: true }).click();
  const recordRequest = page.waitForResponse(response => response.url().includes("/api/dashboard/records"));
  await page.getByRole("button", { name: /^2026-10-01/ }).click();
  expect((await recordRequest).status()).toBe(200);
  await page.keyboard.press("Escape");
  let handoffUrl = "";
  await page.route("**/api/dashboard/sales-handoff?**", route => { handoffUrl = route.request().url(); return route.fulfill({ status: 503, json: { error: "No live fixture" } }); });
  await page.getByRole("button", { name: "SDR meeting handoff", exact: true }).click();
  await expect(page.getByText("No live fixture")).toBeVisible();
  expect(new URL(handoffUrl).searchParams.get("salesRepId")).toBe("31558980");
  expect(new URL(handoffUrl).searchParams.get("from")).toBe("2026-10-01");
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
  await page.getByRole("button", { name: "AI SDR Agent", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ask the data. Choose the next move." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask SDR Agent", exact: true })).toBeDisabled();
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
