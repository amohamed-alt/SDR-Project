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
  await expect(page.getByRole("dialog", { name: "All open tasks", exact: true })).toBeVisible();
});
