import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_playwright_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Playwright CI");
    sessionStorage.setItem("sdr_v2_session_id", "session_playwright_ci");
  });
});

for (const owner of ["marita", "daniel"]) {
  test(`${owner}: tools stay in the sidebar across navigation, reload and escape`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/?acq=${owner}`);
    const sidebar = page.locator("aside.sidebar:visible");
    const tools = sidebar.getByRole("region", { name: "SDR Tools", exact: true });
    await expect(tools).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Close )?SDR Tools$/ })).toHaveCount(0);
    expect(await sidebar.evaluate((element) => {
      const ownerCard = element.querySelector(".owner-card");
      const toolsRegion = element.querySelector('[aria-label="SDR Tools"]');
      return Boolean(ownerCard && toolsRegion && (ownerCard.compareDocumentPosition(toolsRegion) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);

    const clickTool = async (name: string) => {
      const control = tools.getByRole("button", { name: new RegExp(`^${name}(?:\\s|$)`) });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      await control.click();
      return control;
    };

    const calls = await clickTool("Calls");
    await expect(page).toHaveURL(/view=maqsam/);
    await expect(calls).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await page.locator(".content:visible").click({ position: { x: 10, y: 10 } });
    await expect(tools).toBeVisible();

    await clickTool("Team Activity");
    await expect(page).toHaveURL(/view=team-activity/);
    await clickTool("Lead Inventory");
    await expect(page).toHaveURL(/view=inventory/);
    await page.goBack();
    await expect(page).toHaveURL(/view=team-activity/);
    await expect(tools.getByRole("button", { name: /^Team Activity\b/ })).toHaveAttribute("aria-current", "page");

    await page.reload();
    await expect(tools).toBeVisible();
    await expect(tools.getByRole("button", { name: /^Team Activity\b/ })).toHaveAttribute("aria-current", "page");

    const companyRepair = tools.getByRole("button", { name: /^Company Repair\b/ });
    await companyRepair.scrollIntoViewIfNeeded();
    await companyRepair.click();
    await expect(tools.getByPlaceholder("Admin password")).toBeVisible();
    await expect(page).not.toHaveURL(/company-enrichment/);

    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const callsControl = tools.getByRole("button", { name: /^Calls\b/ });
      await callsControl.scrollIntoViewIfNeeded();
      await expect(callsControl).toBeVisible();
      const box = await callsControl.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: testInfo.outputPath(`${owner}-sidebar-${width}.png`) });
    }
  });
}
