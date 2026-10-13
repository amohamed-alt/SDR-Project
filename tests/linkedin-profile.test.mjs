import assert from "node:assert/strict";
import test from "node:test";
import { safeLinkedInProfileUrl, contactLinkedInProfile } from "../src/lib/linkedin-profile.ts";

test("opens existing person URLs and removes tracking without inventing an identity", () => {
  assert.equal(safeLinkedInProfileUrl(" http://sa.linkedin.com/in/ahmed-123/?trk=task#about "), "https://www.linkedin.com/in/ahmed-123");
  assert.equal(safeLinkedInProfileUrl("linkedin.com/in/Ahmed-123"), "https://www.linkedin.com/in/Ahmed-123");
  assert.equal(safeLinkedInProfileUrl("https://www.linkedin.com/in/%D8%A3%D8%AD%D9%85%D8%AF"), "https://www.linkedin.com/in/%D8%A3%D8%AD%D9%85%D8%AF");
  assert.equal(safeLinkedInProfileUrl("https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH,456?trk=abc"), "https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH,456");
});

test("rejects unsafe destinations, non-person URLs and malformed encoded paths", () => {
  for (const input of [
    "", null, "Ahmed Mohamed", "https://linkedin.com", "https://linkedin.com/company/example",
    "https://linkedin.com.evil.test/in/ahmed", "https://evil-linkedin.com/in/ahmed",
    "https://linkedin.com@evil.test/in/ahmed", "https://user:pass@linkedin.com/in/ahmed",
    "javascript:alert(1)", "data:text/html,hello", "https://linkedin.com:444/in/ahmed",
    "https://linkedin.com/redirect?url=https://evil.test", "https://linkedin.com/in/ahmed/details/",
    "https://linkedin.com/in/ahmed%2Fother", "https://linkedin.com/in/ahmed%00",
    "https://linkedin.com/in/ahmed%5Cother", "https://linkedin.com/in/ahmed%ZZ",
    "https://linkedin.com/in/ahmed name", "https://linkedin.com/in/ahmed%3Fother",
  ]) assert.equal(safeLinkedInProfileUrl(input), "", String(input));
});

test("CRM mapping uses the first valid saved property, including legacy mappings", () => {
  const preferred = "https://www.linkedin.com/in/preferred";
  assert.equal(contactLinkedInProfile({ gtm_linkedin_url: preferred, hs_linkedin_url: "https://linkedin.com/in/older" }), preferred);
  for (const field of ["linkedin_profile_link", "hs_linkedin_url", "linkedin_url"]) {
    assert.equal(contactLinkedInProfile({ gtm_linkedin_url: "https://evil.test/in/fake", [field]: "linkedin.com/in/valid" }), "https://www.linkedin.com/in/valid");
  }
  assert.equal(contactLinkedInProfile(undefined), "");
  assert.equal(contactLinkedInProfile({ gtm_linkedin_url: "https://linkedin.com/company/company" }), "");
});

test("task record pagination and CSV retain the linked contact profile", async () => {
  const { queryDashboardRecords, dashboardRecordsCsv } = await import("../src/lib/dashboard-records.ts");
  const profile = "https://www.linkedin.com/in/saved-contact";
  const data = { meta: { generatedAt: "2026-10-13T10:00:00Z" }, recentActivities: [{ id: "task-1", type: "Task", subject: "Contact outreach", relatedContactLinkedinUrl: profile }] };
  const result = queryDashboardRecords(data, { kind: "activities" });
  assert.equal(result.rows[0].relatedContactLinkedinUrl, profile);
  const csv = dashboardRecordsCsv(result.rows);
  assert.match(csv, /relatedContactLinkedinUrl/);
  assert.ok(csv.includes(profile));
});
