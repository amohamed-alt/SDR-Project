import assert from "node:assert/strict";
import test from "node:test";
import {
  acquisitionAccountWritePayload,
  acquisitionPersonWritePayload,
} from "../src/lib/acquisition-data-api.ts";

test("acquisition account writes omit read-only aggregate and timestamp fields", () => {
  const payload = acquisitionAccountWritePayload({
    domain: "example.com",
    name: "Example",
    source: "approved",
    sourceId: "example",
    country: "Saudi Arabia",
    employeeCount: 100,
    industry: "Software",
    activeJobs: 4,
    headcountGrowth: 10,
    hrHeadcount: 5,
    careerPageUrl: "https://example.com/careers",
    detectedAts: "",
    gtmScore: 80,
    gtmTier: "A",
    fitScore: 80,
    intentScore: 70,
    atsOpportunityScore: 60,
    exclusionStatus: "eligible",
    exclusionReason: "",
    hubspotCompanyId: "",
    status: "candidate",
    primaryPersona: "Talent Acquisition",
    secondaryPersona: "HR",
    economicBuyer: "CHRO",
    technicalInfluencer: "HRIS",
    strongestSignal: "Hiring",
    recommendedAngle: "Growth",
    assignedOwnerId: "",
    assignedOwnerName: "",
    evidence: {},
    peopleCount: 2,
    enrichedCount: 1,
    phoneReadyCount: 1,
    pushCount: 0,
    createdAt: "2026-08-22T00:00:00Z",
    updatedAt: "2026-08-23T00:00:00Z",
  });

  assert.equal(payload.domain, "example.com");
  assert.deepEqual(
    Object.keys(payload).filter((key) => [
      "peopleCount", "enrichedCount", "phoneReadyCount", "pushCount", "createdAt", "updatedAt",
    ].includes(key)),
    [],
  );
});

test("acquisition person writes omit the read-only timestamp", () => {
  const payload = acquisitionPersonWritePayload({
    uid: "person-1",
    accountDomain: "example.com",
    fullName: "Person One",
    title: "Talent Acquisition Manager",
    currentCompany: "Example",
    location: "Riyadh",
    linkedinUrl: "",
    rankScore: 90,
    fitReason: "Strong match",
    emails: [],
    phones: [],
    enrichmentStatus: "search_only",
    selected: true,
    meta: {},
    updatedAt: "2026-08-23T00:00:00Z",
  });

  assert.equal(payload.uid, "person-1");
  assert.equal("updatedAt" in payload, false);
});
