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
  // Free Companion handoff updates the visible queue without a manual reload.
  synced = true;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("salesnav:profiles-synced")));
  await page.getByRole("button", { name: /^All \d+$/ }).click();
  await expect(page.getByRole("table").getByText("Needs reveal", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "LinkedIn", exact: true })).toHaveAttribute("href", "https://www.linkedin.com/in/profile-qa");
  await page.getByRole("button", { name: "Select visible", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reveal selected (1)", exact: true })).toBeEnabled();
  expect(reveals).toBe(0);
});
test("an active capture receives new pages and usable public URLs before the search finishes", async ({ page }) => {
  expect((await page.request.post("/api/prospecting/salesnav/full-run", { data: {} })).status()).toBe(401);
  await page.addInitScript(() => { localStorage.setItem("sdr_v2_visitor_id", "stream_handoff_qa"); localStorage.setItem("sdr_v2_visitor_name", "Stream QA"); });
  await page.request.post("/api/sdr-admin", { data: { password: "playwright-tools-only-password" } });
  expect((await page.request.post("/api/prospecting/salesnav/full-run", { headers: { origin: "https://external.example", "sec-fetch-site": "cross-site", "x-acquisition-owner-token": "playwright-tools-only-password" }, data: {} })).status()).toBe(403);
  let streamed = false, checks = 0, reveals = 0, repairs = 0;
  const first = { name: "Stream First Person", title: "HR Director", company: "Example A", location: "Riyadh", connectionDegree: "2nd", salesLeadUrl: "https://www.linkedin.com/sales/lead/STREAM1,SEARCH,x", linkedinUrl: "" };
  const second = { ...first, name: "Stream Second Person", company: "Example B", salesLeadUrl: "https://www.linkedin.com/sales/lead/STREAM2,SEARCH,x" };
  const run = { id: "00000000-0000-4000-8000-000000000003", startedAt: "2026-10-15T10:00:00Z", updatedAt: "2026-10-15T10:01:00Z", completedAt: "", complete: false, stopReason: "", sourceUrl: "https://www.linkedin.com/sales/search/people", searchFingerprint: "stream-qa", pagesRead: 1, total: 1 };
  await page.route("**/api/prospecting/salesnav/full-run*", route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ runId: run.id, salesLeadUrl: first.salesLeadUrl, linkedinUrl: "https://www.linkedin.com/in/stream-first" });
      streamed = true; repairs += 1;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { run: { ...run, pagesRead: streamed ? 2 : 1, total: streamed ? 2 : 1, leads: streamed ? [{ ...first, linkedinUrl: "https://www.linkedin.com/in/stream-first" }, second] : [first] }, history: [run] } });
  });
  await page.route("**/api/prospecting/salesnav/companion", route => route.fulfill({ json: { ok: true, paired: true, unlocked: true, latestFullRun: run } }));
  await page.route("**/api/prospecting/salesnav/task-options", route => route.fulfill({ json: { owners: [] } }));
  await page.route("**/api/prospecting/salesnav/precheck-v2", route => { checks += 1; return route.fulfill({ json: { contact: { inHubSpot: false }, company: { protected: false, inHubSpot: false } } }); });
  await page.route("**/api/prospecting/salesnav/reveal-fast", route => { reveals += 1; return route.fulfill({ status: 500, json: { error: "No paid actions in this fixture." } }); });
  await page.goto("/signalhire-queue");
  await expect(page.getByRole("table").getByText("Awaiting profile read", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "HubSpot Check", exact: true }).click();
  await expect(page.getByRole("button", { name: /^All 1$/ })).toHaveAttribute("data-active", "true");
  expect(checks).toBe(0);
  await page.getByRole("row").filter({ hasText: "Stream First Person" }).getByRole("button", { name: "Add profile URL", exact: true }).click();
  await page.getByRole("textbox", { name: "Public LinkedIn URL for Stream First Person", exact: true }).fill("https://www.linkedin.com/in/stream-first");
  await page.getByRole("button", { name: "Save profile URL", exact: true }).click();
  await expect(page.getByRole("button", { name: /^All 2$/ })).toBeVisible();
  await expect(page.getByRole("table").getByText("Stream Second Person", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "LinkedIn", exact: true })).toHaveAttribute("href", "https://www.linkedin.com/in/stream-first");
  await expect(page.getByRole("table").getByText("Needs reveal", { exact: true })).toBeVisible();
  expect(checks).toBe(1); expect(reveals).toBe(0); expect(repairs).toBe(1);
});
