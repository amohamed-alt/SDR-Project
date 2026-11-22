import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_layout_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Layout review");
    sessionStorage.setItem("sdr_v2_session_id", "session_layout_ci");
  });
});

for (const owner of ["marita", "daniel"]) {
  test(`${owner} summary keeps secondary metrics and evidence available on demand`, async ({ page }) => {
    await page.goto(`/?acq=${owner}&from=2026-07-01&to=2026-07-19`);
    await expect(page.getByRole("button", { name: /^Calls.*connected/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Companies.*Distinct associated accounts/i })).toBeHidden();
    await page.getByText("More portfolio, email & pipeline metrics", { exact: true }).click();
    await expect(page.getByRole("button", { name: /^Companies.*Distinct associated accounts/i })).toBeVisible();
    await page.getByText("GTM intelligence · risks & data quality", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "GTM intelligence signals" })).toBeVisible();
    await page.getByText("GTM intelligence · risks & data quality", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "GTM intelligence signals" })).toBeHidden();
  });
}

test("comparison metric, source details and owner navigation remain usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?acq=comparison&from=2026-07-01&to=2026-07-19");
  await expect(page.getByRole("heading", { name: "SDR performance", exact: true })).toBeVisible();
  await page.getByLabel("Comparison metric").selectOption("calls");
  await expect(page.getByLabel("Comparison metric")).toHaveValue("calls");
  await page.getByText("Source & pacing details", { exact: true }).first().click();
  await expect(page.getByText(/working days elapsed/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Open Daniel workspace" }).click();
  await expect(page).toHaveURL(/acq=daniel/);
});


test("dashboard toolbar keeps navigation and sharing without presentation mode", async ({ page }) => {
  await page.goto("/?from=2026-07-01&to=2026-07-19&present=1");
  await expect(page.getByRole("button", { name: "Presentation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy link to current dashboard view" })).toBeVisible();
  await expect(page.locator("aside.sidebar")).toBeVisible();
});

test("the date filter starts the reporting week on Sunday and blocks an inverted range", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-22T10:00:00Z"));
  await page.goto("/?from=2026-11-01&to=2026-11-22");
  await page.getByRole("button", { name: "Toggle filters" }).click();
  await page.getByRole("button", { name: "This week" }).click();
  const from = page.getByLabel("From", { exact: true });
  const to = page.getByLabel("To", { exact: true });
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await expect(from).toHaveValue("2026-11-22");
  await expect(to).toHaveValue("2026-11-22");

  await to.fill("2026-11-21");
  await expect(apply).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: "From must be on or before To" })).toBeVisible();
  await expect(page).toHaveURL(/from=2026-11-01&to=2026-11-22/);

  await to.fill("2026-11-22");
  await apply.click();
  await expect(page).toHaveURL(/from=2026-11-22&to=2026-11-22/);
});
