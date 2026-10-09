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
    await expect(page.getByRole("button", { name: /^Calls\b/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Companies\b/ })).toBeHidden();
    await page.getByText("More portfolio, email & pipeline metrics", { exact: true }).click();
    await expect(page.getByRole("button", { name: /^Companies\b/ })).toBeVisible();
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
