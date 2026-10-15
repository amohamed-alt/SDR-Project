import { test, expect } from "@playwright/test";

test("captured people without public URLs stay out of paid reveal until a checked profile is synced", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("sdr_v2_visitor_id", "profile_handoff_qa"); localStorage.setItem("sdr_v2_visitor_name", "Profile QA"); });
  await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  let synced = false, reveals = 0;
  const lead = { name: "Profile QA Person", title: "HR Director", company: "Example", location: "Riyadh", connectionDegree: "2nd", salesLeadUrl: "https://www.linkedin.com/sales/lead/ACwQA,NAME_SEARCH,x", linkedinUrl: "" };
  const run = { id: "00000000-0000-4000-8000-000000000001", startedAt: "2026-10-15T08:00:00Z", updatedAt: "2026-10-15T08:00:00Z", completedAt: "2026-10-15T08:01:00Z", complete: true, stopReason: "Done", sourceUrl: "https://www.linkedin.com/sales/search/people", searchFingerprint: "qa", pagesRead: 1, total: 1 };
  await page.route("**/api/prospecting/salesnav/full-run*", route => route.fulfill({ json: { run: { ...run, leads: [{ ...lead, linkedinUrl: synced ? "https://www.linkedin.com/in/profile-qa" : "" }] }, history: [run] } }));
  await page.route("**/api/prospecting/salesnav/companion", route => route.fulfill({ json: { ok: true, paired: true, unlocked: true, latestFullRun: run } }));
  await page.route("**/api/prospecting/salesnav/task-options", route => route.fulfill({ json: { owners: [{ id: "31644369", name: "Marita" }] } }));
  await page.route("**/api/prospecting/salesnav/precheck-v2", route => route.fulfill({ json: { contact: { inHubSpot: false }, company: { protected: false, inHubSpot: false, gateReason: "Net-new company" } } }));
  await page.route("**/api/prospecting/salesnav/reveal-fast", route => { reveals += 1; return route.fulfill({ status: 500, json: { error: "Paid requests must not run in this fixture." } }); });
  await page.goto("/signalhire-queue");
  await page.getByRole("button", { name: "HubSpot Check", exact: true }).click();
  await expect(page.getByText("Needs profile URL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal selected (0)", exact: true })).toBeDisabled();
  await expect(page.getByText("Missing public profile URLs: 1", { exact: true })).toBeVisible();
  expect(reveals).toBe(0);
  // Simulate the completed free Companion handoff, then reload the same saved run.
  synced = true;
  await page.reload();
  await page.getByRole("button", { name: "HubSpot Check", exact: true }).click();
  await expect(page.getByText("Needs reveal", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "LinkedIn", exact: true })).toHaveAttribute("href", "https://www.linkedin.com/in/profile-qa");
  await page.getByRole("button", { name: "Select visible", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reveal selected (1)", exact: true })).toBeEnabled();
  expect(reveals).toBe(0);
});
