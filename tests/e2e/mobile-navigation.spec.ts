import { test, expect } from "@playwright/test";

for (const width of [390, 800]) {
  test(`navigation at ${width}px exposes all workspaces and closes after selection`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("sdr_v2_visitor_id", "visitor_mobile_navigation_ci");
      localStorage.setItem("sdr_v2_visitor_name", "Mobile navigation QA");
      sessionStorage.setItem("sdr_v2_session_id", "session_mobile_navigation_ci");
    });
    await page.goto("/?acq=ursula&from=2026-07-01&to=2026-07-19");
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await expect(menu).toBeVisible();
    await expect(page.locator("aside.sidebar")).toBeHidden();
    await menu.click();
    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("button", { name: "Zein Talentera", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await page.getByRole("button", { name: "Daniel Evalufy", exact: true }).click();
    await expect(page).toHaveURL(/acq=daniel/);
    await expect(page.locator("aside.sidebar")).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Data Quality", exact: true }).click();
    await expect(page).toHaveURL(/tab=quality/);
    await expect(page.locator("aside.sidebar")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Data Quality", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
