import { expect, test } from "@playwright/test";

test("record drawer contains keyboard focus and restores the metric on close", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_drawer_keyboard_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Drawer keyboard QA");
    sessionStorage.setItem("sdr_v2_session_id", "session_drawer_keyboard_ci");
  });
  // A deterministic empty result still has the search and sortable headers,
  // while demo mode intentionally has no external HubSpot footer destination.
  await page.route("**/api/dashboard/records**", route => route.fulfill({ json: { rows: [], total: 0, offset: 0, limit: 50, version: "keyboard-qa" } }));
  await page.goto("/");
  const metric = page.getByRole("button", { name: /^Tasks due today/i });
  await metric.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Tasks due today", exact: true });
  const close = drawer.getByRole("button", { name: "Close", exact: true });
  const lastControl = drawer.getByRole("button", { name: "Due bucket", exact: true });
  await expect(close).toBeFocused();
  await expect(drawer.getByText("No matching records. Try a different search.")).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(lastControl).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  const search = drawer.getByRole("textbox", { name: "Search records" });
  await expect(search).toBeFocused();
  await search.fill("no matching contact keyboard QA");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(metric).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(close).toBeFocused();
  await close.click();
  await expect(drawer).toHaveCount(0);
  await expect(metric).toBeFocused();
});
