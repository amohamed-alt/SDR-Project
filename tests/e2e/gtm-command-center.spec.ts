import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_playwright_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Playwright CI");
    sessionStorage.setItem("sdr_v2_session_id", "session_playwright_ci");
  });
});

test("dashboard loads and global command palette opens", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SDR Command Center").first()).toBeVisible();
  await expect(page.getByText("Demo data").first()).toBeVisible();

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "GTM command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByPlaceholder("Search dashboard, accounts, prospecting…")).toBeFocused();
});

test("shareable analytics URL restores the Pipeline view", async ({ page }) => {
  await page.goto("/?from=2026-09-01&to=2026-09-09&tab=pipeline");

  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/from=2026-09-01/);
  await expect(page).toHaveURL(/to=2026-09-09/);
  await expect(page).toHaveURL(/tab=pipeline/);
});

test("KPI drilldown exposes the operational table surface", async ({ page }) => {
  await page.goto("/");

  const companiesKpi = page.getByRole("button", { name: /Companies.*Distinct associated accounts/i }).first();
  await expect(companiesKpi).toBeVisible();
  await companiesKpi.click();

  const drawer = page.getByRole("dialog", { name: "Associated companies" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: "Search records" })).toBeVisible();
  await expect(drawer.getByRole("columnheader", { name: /Company/i })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "CSV" })).toBeVisible();
});

test("Daniel deep links render the Evalufy workspace on the server", async ({ page }) => {
  const response = await page.request.get("/?acq=daniel");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("Evalufy");
  expect(html).not.toContain('aria-label="Talentera ATS"');

  await page.goto("/?acq=daniel");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar").getByRole("button", { name: /Inbound vs Outbound/i })).toBeVisible();
  await expect(page.locator(".sidebar").getByRole("button", { name: /SDR Tools/i })).toBeVisible();
});

test("switching owners mounts one clean workspace and clears stale tab state", async ({ page }) => {
  await page.goto("/?from=2026-09-01&to=2026-09-09&tab=pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible();

  await page.locator(".sidebar").getByRole("button", { name: /Daniel/i }).click();
  await expect(page).toHaveURL(/acq=daniel/);
  await expect(page).not.toHaveURL(/tab=/);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator("main.app-shell")).toHaveCount(1);
});

test("comparison remains inside the shared dashboard shell", async ({ page }) => {
  await page.goto("/?acq=comparison");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.getByRole("heading", { name: "SDR performance", exact: true })).toBeVisible();
  await expect(page.locator("main.app-shell")).toHaveCount(1);
});
