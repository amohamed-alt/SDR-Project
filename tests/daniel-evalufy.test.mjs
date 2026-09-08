import assert from "node:assert/strict";
import test from "node:test";
import {
  MARITA_OWNER_ID,
  danielEvalufyDueAt,
  evaluateDanielCompany,
  evaluateDanielContact,
  isDanielEvalufyWorkDate,
} from "../src/lib/daniel-evalufy.ts";

test("Daniel Evalufy window is Sunday-Thursday only from Sep 13 through Sep 30", () => {
  assert.equal(isDanielEvalufyWorkDate("2026-09-13"), true);
  assert.equal(isDanielEvalufyWorkDate("2026-09-17"), true);
  assert.equal(isDanielEvalufyWorkDate("2026-09-18"), false);
  assert.equal(isDanielEvalufyWorkDate("2026-09-19"), false);
  assert.equal(isDanielEvalufyWorkDate("2026-09-30"), true);
  assert.equal(isDanielEvalufyWorkDate("2026-10-01"), false);
  assert.equal(danielEvalufyDueAt("2026-09-13"), "2026-09-13T09:00:00+03:00");
});

test("clean unowned ATS company with no activity or deals is eligible", () => {
  const result = evaluateDanielCompany({
    hubspot_owner_id: "",
    detected_ats: "Workday",
    ats_status: "detected",
    num_associated_deals: "0",
    hs_num_open_deals: "0",
    account_type: "Acquisition",
    account_status: "Never purchased",
    company_type: "Large Enterprise",
    hs_lead_status: "NEW",
  });
  assert.deepEqual(result, { eligible: true, reasons: [] });
});

test("company is rejected for communication, ownership, deals, retention, or job seeker status", () => {
  const result = evaluateDanielCompany({
    hubspot_owner_id: "999",
    detected_ats: "SAP SuccessFactors",
    ats_status: "detected",
    notes_last_contacted: "2026-09-01T10:00:00Z",
    num_associated_deals: "1",
    account_type: "Retention",
    company_type: "Job Seeker",
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("company_owned"));
  assert.ok(result.reasons.includes("company_has_activity"));
  assert.ok(result.reasons.includes("company_has_deal"));
  assert.ok(result.reasons.includes("retention"));
  assert.ok(result.reasons.includes("job_seeker"));
});

test("Marita source ownership can be transferred but another owner cannot", () => {
  const maritaContact = evaluateDanielContact({
    hubspot_owner_id: MARITA_OWNER_ID,
    mobilephone: "+966500000000",
  });
  assert.equal(maritaContact.eligible, true);

  const salesOwned = evaluateDanielContact({
    hubspot_owner_id: "999",
    mobilephone: "+966500000000",
  });
  assert.equal(salesOwned.eligible, false);
  assert.ok(salesOwned.reasons.includes("contact_owned"));
});

test("contact requires a mobile number and zero prior engagement", () => {
  const missingMobile = evaluateDanielContact({
    hubspot_owner_id: "",
    phone: "+966500000000",
  });
  assert.equal(missingMobile.eligible, false);
  assert.ok(missingMobile.reasons.includes("mobile_missing"));

  const contacted = evaluateDanielContact({
    hubspot_owner_id: "",
    mobilephone: "+966500000000",
    notes_last_contacted: "2026-09-05T10:00:00Z",
  });
  assert.equal(contacted.eligible, false);
  assert.ok(contacted.reasons.includes("contact_has_activity"));
});
