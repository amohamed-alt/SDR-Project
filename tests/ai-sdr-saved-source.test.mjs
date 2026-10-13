import test from "node:test";
import assert from "node:assert/strict";
import { readSavedAiSdrLeads } from "../src/lib/ai-sdr-saved-source.ts";
import { assessAiSdrLead } from "../src/lib/ai-sdr-qualification.ts";

const savedLead = index => ({ name: `Person ${index}`, company: `Company ${index}`, title: "HR Director", location: "Riyadh", connectionDegree: "2nd", linkedinUrl: "", salesLeadUrl: `https://www.linkedin.com/sales/lead/ACw${index},NAME_SEARCH,123?trk=search` });

test("saved Sales Nav-only identities load a bounded review batch without inventing public profiles", () => {
  const intake = readSavedAiSdrLeads(Array.from({ length: 70 }, (_, index) => savedLead(index)));
  assert.equal(intake.leads.length, 30);
  assert.equal(intake.total, 70);
  assert.equal(intake.overLimit, 40);
  assert.equal(intake.needsPublicProfile, 30);
  assert.equal(intake.leads[0].linkedinUrl, "");
  assert.equal(intake.leads[0].salesLeadUrl, "https://www.linkedin.com/sales/lead/ACw0,NAME_SEARCH,123");
  const candidate = { ...intake.leads[0], companyDomain: "company.example", companyCountry: "Saudi Arabia", employeeCount: 500, atsStatus: "verified_no_ats", atsEvidence: "Reviewed career page" };
  const check = { contact: { inHubSpot: false }, company: { inHubSpot: false, engagementChecked: true } };
  const result = assessAiSdrLead(candidate, check);
  assert.equal(result.status, "review");
  assert.match(result.reason, /verified public LinkedIn/);
});

test("validation and deduplication precede the cap, repeated loads use remaining capacity", () => {
  const invalid = Array.from({ length: 30 }, () => ({ ...savedLead(0), salesLeadUrl: "https://evil.example/sales/lead/ACw0" }));
  const batch = [...invalid, { ...savedLead(1), connectionDegree: " 1st " }, savedLead(2), savedLead(2), savedLead(3)];
  const intake = readSavedAiSdrLeads(batch);
  assert.equal(intake.leads.length, 2);
  assert.equal(intake.invalid, 30);
  assert.equal(intake.firstDegree, 1);
  assert.equal(intake.duplicates, 1);
  assert.equal(readSavedAiSdrLeads(batch, intake.leads).leads.length, 0);
  const withVerifiedProfiles = intake.leads.map((lead, index) => ({ ...lead, linkedinUrl: `https://www.linkedin.com/in/verified-${index}` }));
  assert.equal(readSavedAiSdrLeads(batch, withVerifiedProfiles).leads.length, 0);
  const existing = readSavedAiSdrLeads(Array.from({ length: 29 }, (_, index) => savedLead(index))).leads;
  const next = readSavedAiSdrLeads([savedLead(0), savedLead(30), savedLead(31)], existing);
  assert.equal(next.leads.length, 1);
  assert.equal(next.duplicates, 1);
  assert.equal(next.overLimit, 1);
});

test("public URLs remain preferred and imported research cannot imply verified company evidence", () => {
  const intake = readSavedAiSdrLeads([{ ...savedLead(1), linkedinUrl: "https://www.linkedin.com/in/Person-One/?trk=x", atsStatus: "verified_no_ats", employeeCount: 500, companyCountry: "Saudi Arabia" }]);
  assert.equal(intake.leads[0].linkedinUrl, "https://www.linkedin.com/in/person-one");
  assert.equal(intake.leads[0].employeeCount, null);
  assert.equal(intake.leads[0].companyCountry, "");
  assert.equal(intake.leads[0].atsStatus, "unknown");
  assert.equal(readSavedAiSdrLeads(null).leads.length, 0);
});
