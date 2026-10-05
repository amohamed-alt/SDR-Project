import { expect, test } from "@playwright/test";
import { reviewHandoff } from "../../src/lib/handoff-review";
const now = Date.parse("2026-10-05T09:00:00Z");
function account(id: string, name: string, connected: boolean | null) {
  const url = `https://app-eu1.hubspot.com/contacts/145742477/record/0-1/${id}`;
  const events = connected === null ? [] : [{ id: `call-${id}`, type: "Call" as const, at: "2026-10-02T12:00:00Z", detail: "Follow-up call", outcome: connected ? "Connected" : "No answer", connected, url }];
  return { id: `meeting-${id}`, meetingId: `meeting-${id}`, meetingTitle: "Discovery", meetingDate: "2026-10-01T11:00:00Z", meetingEnd: "2026-10-01T12:00:00Z", outcome: "COMPLETED", bookedBy: { id: "31644369", name: "Marita Chedid" }, salesRep: { id: "76369997", name: "Ursula Waked" }, company: { id, name, domain: `${name.toLowerCase()}.example`, url }, contacts: [{ id, name: `${name} Contact`, email: `hr@${name.toLowerCase()}.example`, phone: "", url }], deal: { id: `deal-${id}`, name: `${name} proposal`, stage: "Proposal Shared", owner: "Ursula Waked", isOpen: true, isClosedWon: false, amount: 0, createdAt: "2026-10-01T14:00:00Z", url }, dealCreatedAfterMeeting: true, nextTask: null, overdueTask: null, recordUrl: url, review: reviewHandoff({ endAt: "2026-10-01T12:00:00Z", outcome: "COMPLETED", events, linked: true, closed: false, nextTask: false, overdueTask: false }, now), attention: { level: "warning", reason: "No upcoming Sales follow-up task" } };
}
const future = { ...account("3", "Gamma", null), meetingDate: "2026-10-05T12:00:00Z", meetingEnd: "2026-10-05T13:00:00Z", outcome: "SCHEDULED", review: reviewHandoff({ endAt: "2026-10-05T13:00:00Z", outcome: "SCHEDULED", events: [], linked: true, closed: false, nextTask: false, overdueTask: false }, now), attention: { level: "ok", reason: "Upcoming meeting" } };
const payload = { meta: { generatedAt: "2026-10-05T09:00:00Z", from: "2026-07-13", to: "2026-10-05", timezone: "Asia/Riyadh", followUpThrough: "2026-10-05", excludedUnattributed: 3, salesRep: { id: "all", name: "Ursula + Zein" }, sdrs: [{ id: "31644369", name: "Marita Chedid" }, { id: "37624223", name: "Daniel Beaini" }], salesReps: [{ id: "76369997", name: "Ursula Waked" }, { id: "31558980", name: "Zein Fares" }], cache: "hit" }, rows: [account("1", "Alpha", false), account("2", "Beta", null), future] };
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sdr_v2_visitor_id", "visitor_playwright_ci");
    localStorage.setItem("sdr_v2_visitor_name", "Playwright CI");
    sessionStorage.setItem("sdr_v2_session_id", "session_playwright_ci");
  });
  await page.route("**/api/dashboard/sales-handoff?**", route => route.fulfill({ json: payload }));
});
test("management drill-down distinguishes no effort from unanswered attempts", async ({ page }) => {
  const request = page.waitForRequest(request => request.url().includes("/api/dashboard/sales-handoff?"));
  await page.goto("/?view=sales-handoff&from=2026-10-01&to=2026-10-05");
  const query = new URL((await request).url()).searchParams;
  expect(query.get("from")).toBe("2026-07-13");
  expect(query.get("salesRepId")).toBe("all");
  await expect(page.getByRole("heading", { name: "SDR Handoff Follow-up" })).toBeVisible();
  await page.getByRole("button", { name: "Proposal Shared: all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Gamma", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Beta", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^No logged follow-up/ }).click();
  await expect(page.getByRole("button", { name: "Beta", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Proposal Shared: noConnectedCall", exact: true }).click();
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Alpha", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Call · No answer", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: /Alpha Contact.*Open contact timeline/ })).toHaveAttribute("href", /record\/0-1\/1/);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});
test("management view remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=sales-handoff");
  await expect(page.getByRole("heading", { name: "SDR Handoff Follow-up" })).toBeVisible();
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Beta", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("No associated Sales follow-up is logged after this meeting.")).toBeVisible();
});
