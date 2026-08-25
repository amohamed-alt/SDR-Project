import assert from "node:assert/strict";
import test from "node:test";
import { verifyGenericHiringJobs } from "../src/lib/hiring-verification.ts";

test("accepts recent structured postings without spending a web search", async () => {
  const result = await verifyGenericHiringJobs({
    companyName: "Example Company",
    companyDomain: "example.com",
    careerPageUrl: "https://example.com/careers",
    sourceUrl: "https://example.com/careers",
    checkedAt: "2026-08-25T12:00:00.000Z",
    candidates: [{
      externalId: "job-1",
      title: "Senior Recruiter",
      location: "Riyadh",
      department: "People",
      url: "https://example.com/jobs/1",
      postedAt: "2026-08-20T10:00:00.000Z",
    }],
  });

  assert.equal(result.conclusive, true);
  assert.equal(result.method, "structured-freshness");
  assert.equal(result.webSearchUsed, false);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.rejectedStaleCount, 0);
});

test("does not count stale structured postings when the official source is explicitly empty", async () => {
  const result = await verifyGenericHiringJobs({
    companyName: "Example Company",
    companyDomain: "example.com",
    careerPageUrl: "https://example.com/careers",
    sourceUrl: "https://example.com/careers",
    checkedAt: "2026-08-25T12:00:00.000Z",
    explicitEmpty: true,
    candidates: [{
      externalId: "old-job",
      title: "Old Vacancy",
      location: "Dubai",
      department: "Sales",
      url: "https://example.com/jobs/old",
      postedAt: "2025-01-10T10:00:00.000Z",
    }],
  });

  assert.equal(result.conclusive, true);
  assert.equal(result.method, "verified-empty");
  assert.equal(result.jobs.length, 0);
  assert.equal(result.rejectedStaleCount, 1);
  assert.equal(result.webSearchUsed, false);
});
