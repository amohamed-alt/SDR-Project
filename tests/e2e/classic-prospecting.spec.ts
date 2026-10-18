import { test, expect } from "@playwright/test";

test("classic capture checks then reveals a name/company person without profile reading or CRM writes", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("sdr_v2_visitor_id", "classic_qa"); localStorage.setItem("sdr_v2_visitor_name", "Classic QA"); });
  await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  page.on("dialog", dialog => dialog.accept());
  const lead = { name: "Classic Person", company: "Example", title: "HR Director", location: "Riyadh", connectionDegree: "2nd", salesLeadUrl: "https://www.linkedin.com/sales/lead/CLASSIC", linkedinUrl: "" };
  const run = { id: "00000000-0000-4000-8000-000000000090", startedAt: "2026-10-18T08:00:00Z", updatedAt: "2026-10-18T08:00:00Z", completedAt: "2026-10-18T08:00:00Z", complete: true, pagesRead: 1, total: 1, stopReason: "Captured", clientVersion: "1.8.3", leads: [lead] };
  let checks = 0, reveals = 0, writes = 0;
  await page.route("**/api/prospecting/salesnav/full-run*", route => route.fulfill({ json: { run, history: [run] } }));
  await page.route("**/api/prospecting/salesnav/task-options", route => route.fulfill({ json: { owners: [] } }));
  await page.route("**/api/prospecting/salesnav/companion", route => route.fulfill({ json: { ok: true, paired: true, unlocked: true, latestFullRun: run } }));
  await page.route("**/api/prospecting/salesnav/precheck-v2", route => { checks++; return route.fulfill({ json: { contact: { inHubSpot: false }, company: { protected: false, inHubSpot: false } } }); });
  await page.route("**/api/prospecting/salesnav/reveal-fast", route => {
    reveals++;
    expect(route.request().postDataJSON().lead.linkedinUrl).toBe("");
    expect(route.request().postDataJSON().lead.name).toBe(lead.name);
    return route.fulfill({ json: { prospect: { fullName: lead.name, company: lead.company, phone: "+966500000001", linkedinUrl: "https://www.linkedin.com/in/classic-person" } } });
  });
  await page.route("**/api/prospecting/salesnav/push-ready-v2", route => { writes++; return route.fulfill({ status: 500 }); });
  await page.goto("/signalhire-queue");
  await expect(page.getByRole("button", { name: "HubSpot Check", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Read \/ retry/ })).toBeHidden();
  await page.getByRole("button", { name: "HubSpot Check", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: lead.name })).toContainText("Needs reveal");
  await page.getByRole("button", { name: "Select visible", exact: true }).click();
  await page.getByRole("button", { name: "Reveal selected (1)", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: lead.name })).toContainText("Ready NEW");
  await expect(page.getByRole("link", { name: "LinkedIn", exact: true })).toHaveAttribute("href", "https://www.linkedin.com/in/classic-person");
  expect(checks).toBe(1); expect(reveals).toBe(1); expect(writes).toBe(0);
});
