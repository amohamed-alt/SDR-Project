import { expect, test } from "@playwright/test";

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
