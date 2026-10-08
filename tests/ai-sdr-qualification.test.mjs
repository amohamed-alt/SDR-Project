import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  AI_SDR_BATCH_LIMIT, AI_SDR_DANIEL_ID, AI_SDR_MARITA_ID,
  assessAiSdrLead, parseAiSdrBatch, normalizePersonUrl,
} from "../src/lib/ai-sdr-qualification.ts";

const lead = {
  name: "Test Person",
  title: "HR Director",
  company: "Example Private Company",
  location: "Riyadh",
  linkedinUrl: "https://www.linkedin.com/in/example-person",
  salesLeadUrl: "",
  companyDomain: "example.com",
  companyCountry: "Saudi Arabia",
  employeeCount: 500,
  detectedAts: "",
  atsStatus: "unknown",
  atsEvidence: "",
  sector: "Private",
};
const check = {
  contact: { inHubSpot: false },
  company: { inHubSpot: false, ownerId: "", engagementChecked: true,
    accountType: "", accountStatus: "", protected: false, meetingCount: 0,
    connectedCallCount: 0, openDeals: 0, detectedAts: "" },
};

test("research intake enforces valid public profiles, batch limit and zero-trust ATS claims", () => {
  const items = Array.from({ length: AI_SDR_BATCH_LIMIT + 2 }, (_, index) => ({
    ...lead, name: "Person " + index, linkedinUrl: "https://www.linkedin.com/in/person-" + index,
    atsStatus: "verified_with_ats", atsEvidence: "invented",
  }));
  const { leads, truncated } = parseAiSdrBatch(JSON.stringify({ leads: items }));
  assert.equal(leads.length, AI_SDR_BATCH_LIMIT);
  assert.equal(truncated, true);
  assert.equal(leads[0].atsStatus, "unknown");
  assert.equal(leads[0].atsEvidence, "");
  assert.equal(normalizePersonUrl("https://evil-linkedin.com/in/example"), "");
  assert.equal(normalizePersonUrl("http://www.linkedin.com/in/example"), "");
  assert.equal(normalizePersonUrl("https://www.linkedin.com/in/Example/?trk=x"), "https://www.linkedin.com/in/example");
});

test("CRM review is mandatory and unknown ATS never routes to Marita by assumption", () => {
  assert.equal(assessAiSdrLead(lead).status, "review");
  assert.match(assessAiSdrLead(lead, check).reason, /Verify ATS/);
  assert.match(assessAiSdrLead(lead, { ...check, company: { ...check.company, detectedAts: "Direct Application Form" } }).reason, /Verify ATS/);
  assert.equal(assessAiSdrLead({ ...lead, employeeCount: 120, atsStatus: "verified_no_ats", atsEvidence: "Checked career page" }, check).status, "blocked");
  assert.equal(assessAiSdrLead({ ...lead, companyCountry: "" }, check).status, "review");
  assert.equal(assessAiSdrLead({ ...lead, companyCountry: "United Arab Emirates" }, check).status, "blocked");
});

test("connected calls, meetings, RM ownership, open deals, active customers and retention block new pushes", () => {
  for (const change of [
    { connectedCallCount: 1 },
    { meetingCount: 1 },
    { openDeals: 1 },
    { ownerId: "different-RM-owner" },
    { accountType: "Retention" },
    { accountStatus: "Active" },
  ]) {
    assert.equal(assessAiSdrLead(lead, { ...check, company: { ...check.company, ...change } }).status, "blocked");
  }
  assert.equal(assessAiSdrLead(lead, { ...check, contact: { inHubSpot: true } }).status, "blocked");
});

test("confirmed ATS routes Daniel, evidenced no ATS routes Marita", () => {
  const atsFromCrm = assessAiSdrLead(lead, { ...check, company: { ...check.company, detectedAts: "Workday" } });
  assert.equal(atsFromCrm.status, "eligible");
  assert.equal(atsFromCrm.ownerId, AI_SDR_DANIEL_ID);
  const noAts = assessAiSdrLead({ ...lead, atsStatus: "verified_no_ats", atsEvidence: "Careers reviewed manually" }, check);
  assert.equal(noAts.status, "eligible");
  assert.equal(noAts.ownerId, AI_SDR_MARITA_ID);
  assert.equal(assessAiSdrLead({ ...lead, atsStatus: "verified_no_ats", atsEvidence: "" }, check).status, "review");
  assert.equal(assessAiSdrLead({ ...lead, atsStatus: "verified_with_ats", atsEvidence: "Confirmed ATS URL" }, {
    ...check, company: { ...check.company, ownerId: AI_SDR_MARITA_ID },
  }).status, "review");
});

test("the AI SDR route is protected and paid reveals never run during precheck", () => {
  const access = readFileSync("src/lib/tool-access.ts", "utf8");
  const page = readFileSync("src/components/AiSdrAgentWorkspace.tsx", "utf8");
  const push = readFileSync("src/app/api/ai/lead-agent/push/route.ts", "utf8");
  assert.match(access, /"\/ai-sdr-agent"/);
  assert.match(access, /"\/api\/ai"/);
  assert.match(page, /window\.confirm\("Reveal/);
  assert.match(page, /window\.confirm\("Create/);
  assert.match(page, /\/api\/prospecting\/salesnav\/precheck-v2/);
  assert.match(push, /sdrAdminAuthorized/);
  assert.match(push, /existingPush/);
  assert.match(push, /findOpenAccountTask/);
  assert.match(push, /assignmentMode: "acquisition"/);
});
