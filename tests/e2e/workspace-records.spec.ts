import { expect, test } from "@playwright/test";

test("workspace totals and full task drawer use complete records while country filter discloses preview", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_workspace_records_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Workspace records QA");
    sessionStorage.setItem("sdr_v2_session_id", "session_workspace_records_ci");
  });
  await page.route("**/api/dashboard?**", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.kpis.openTasks = 3004;
    data.kpis.dueToday = 42;
    data.kpis.highPriorityOpenTasks = 2168;
    data.recentActivities = ["KSA", "ksa", "Saudi Arabia"].map((country, i) => ({
      id: String(100 + i), type: "Task", subject: country, status: "Not started", detail: "QA task", assignedTo: "Marita",
      occurredAt: data.meta.generatedAt, metricAt: data.meta.generatedAt, dueAt: data.meta.generatedAt, dueBucket: "Due today",
      isOpen: true, isHighPriority: true, opened: false, clicked: false, replied: false, url: "https://app.hubspot.com/contacts/123",
    }));
    await route.fulfill({ json: data });
  });
  await page.route("**/api/hubspot/task-countries", route => route.fulfill({ json: { tasks: ["KSA", "ksa", "Saudi Arabia"].map((country, i) => ({ taskId: String(100 + i), country, source: "contact" })) } }));
  await page.route("**/api/dashboard/records?**", route => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("offset") || 0);
    const limit = Number(params.get("limit") || 50);
    const rows = Array.from({ length: limit }, (_, i) => ({
      id: `pagination-${offset + i + 1}`, type: "Task", subject: `Paginated task ${offset + i + 1}`,
      status: "Not started", detail: "Pagination regression fixture", assignedTo: "Marita",
      occurredAt: "2026-07-19T09:00:00Z", metricAt: "2026-07-19T09:00:00Z",
      dueAt: "2026-07-19T09:00:00Z", dueBucket: "Due today", isOpen: true,
      url: "https://app.hubspot.com/contacts/123",
    }));
    return route.fulfill({ json: { rows, total: 3004, offset, limit, version: params.get("version") } });
  });
  await page.goto("/?workspace=1&acq=marita");
  await expect(page.getByText("Loaded 3 of 3004 open tasks. Country counts are preview counts.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Tasks due today.*42/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /High-priority tasks.*2168/ })).toBeVisible();
  const country = page.getByRole("combobox", { name: "Task country", exact: true });
  await expect(country).toBeVisible();
  await expect(country).toBeEnabled();
  await expect(country.locator("option")).toHaveText(["Preview · all countries (3)", "Saudi Arabia (3)"]);
  const recordsRequest = page.waitForRequest(request => request.url().includes("/api/dashboard/records?"));
  await page.getByRole("button", { name: "Open all 3004 tasks", exact: true }).click();
  const request = await recordsRequest;
  const selection = JSON.parse(new URL(request.url()).searchParams.get("selection") || "{}");
  expect(selection).toEqual({ kind: "activities", where: [{ field: "type", value: "Task" }, { field: "isOpen", value: true }] });
  const drawer = page.getByRole("dialog", { name: "All open tasks", exact: true });
  await expect(drawer).toBeVisible();
  const launcher = page.getByRole("button", { name: "Open GTM command palette", exact: true });
  await expect(launcher).toBeHidden();
  await expect(drawer.getByText("Paginated task 1", { exact: true })).toBeVisible();
  // Click the real footer button with normal hit testing: a floating launcher
  // must not intercept this click even though it lives outside the shell.
  await drawer.getByRole("button", { name: "Next", exact: true }).click();
  await expect(drawer.getByText("Paginated task 51", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Page 2 of 61 · Full matching dataset", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "GTM command palette", exact: true })).toBeHidden();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "GTM command palette", exact: true });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(launcher).toBeVisible();
});
