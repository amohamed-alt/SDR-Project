import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateHiringScore,
  detectHiringSource,
  hiringStatus,
  mergeStoredJobs,
  normalizeTargetCountry,
  parseJobLinks,
  parseJobPostingJsonLd,
  shouldExcludeHiringCompany,
} from "../src/lib/hiring-signals-core.ts";

test("normalizes KSA and UAE company country values", () => {
  assert.equal(normalizeTargetCountry("KSA"), "Saudi Arabia");
  assert.equal(normalizeTargetCountry("Saudi Arabia"), "Saudi Arabia");
  assert.equal(normalizeTargetCountry("UAE"), "United Arab Emirates");
  assert.equal(normalizeTargetCountry("United Arab Emirates"), "United Arab Emirates");
  assert.equal(normalizeTargetCountry("Egypt"), "");
});

test("detects direct public ATS sources", () => {
  assert.deepEqual(detectHiringSource("https://job-boards.greenhouse.io/acme", "Greenhouse"), {
    kind: "greenhouse",
    key: "acme",
    url: "https://job-boards.greenhouse.io/acme",
    confidence: "high",
  });
  assert.equal(detectHiringSource("https://jobs.lever.co/example", "Lever").kind, "lever");
  assert.equal(detectHiringSource("https://careers.smartrecruiters.com/ExampleCo", "SmartRecruiters").kind, "smartrecruiters");
  assert.equal(detectHiringSource("https://jobs.ashbyhq.com/example", "Ashby").key, "ashby:example");
  assert.equal(detectHiringSource("https://example.recruitee.com/", "Recruitee").key, "recruitee:example");
  assert.equal(detectHiringSource("https://apply.workable.com/example/", "Workable").key, "workable:example");
  assert.equal(detectHiringSource("https://acme.wd5.myworkdayjobs.com/en-US/External", "Workday").key, "workday:acme|External");
});

test("recognizes ATS families present in HubSpot even when the career URL is custom", () => {
  assert.equal(detectHiringSource("https://example.com/careers", "SAP SuccessFactors").key, "vendor:successfactors");
  assert.equal(detectHiringSource("https://example.com/careers", "Oracle HCM Cloud").key, "vendor:oracle");
  assert.equal(detectHiringSource("https://example.com/careers", "Teamtailor").key, "vendor:teamtailor");
  assert.equal(detectHiringSource("https://example.com/careers", "iCIMS (Jibe)").key, "vendor:icims");
  assert.equal(detectHiringSource("https://example.com/careers", "Zoho Recruit").key, "vendor:zoho-recruit");
  assert.equal(detectHiringSource("https://example.com/careers", "Unknown").key, "");
});

test("excludes retention and internal Talentera/Bayt companies without broad substring false positives", () => {
  assert.equal(shouldExcludeHiringCompany({ name: "Customer", domain: "customer.com", accountType: "Retention" }), true);
  assert.equal(shouldExcludeHiringCompany({ name: "Test Company", domain: "talentera.com", accountType: "Acquisition" }), true);
  assert.equal(shouldExcludeHiringCompany({ name: "Internal", domain: "jobs.talentera.com", accountType: "Acquisition" }), true);
  assert.equal(shouldExcludeHiringCompany({ name: "bayt", domain: "bayt.com", accountType: "" }), true);
  assert.equal(shouldExcludeHiringCompany({ name: "bayt.com", domain: "bayt.net", accountType: "" }), true);
  assert.equal(shouldExcludeHiringCompany({ name: "SA BAYTUR CONSTRUCTION CO", domain: "baytur.com.sa", accountType: "Acquisition" }), false);
  assert.equal(shouldExcludeHiringCompany({ name: "بيت الاباء", domain: "baytalebaa.com", accountType: "Acquisition" }), false);
});

test("extracts schema.org JobPosting JSON-LD", () => {
  const html = `
    <html><head><script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Senior Recruiter",
        "datePosted": "2026-08-15",
        "url": "/jobs/123",
        "identifier": {"value": "123"},
        "occupationalCategory": "People",
        "jobLocation": {"address": {"addressLocality": "Riyadh", "addressCountry": "Saudi Arabia"}}
      }
    </script></head></html>`;
  const jobs = parseJobPostingJsonLd(html, "https://example.com/careers");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].externalId, "123");
  assert.equal(jobs[0].title, "Senior Recruiter");
  assert.equal(jobs[0].location, "Riyadh, Saudi Arabia");
  assert.equal(jobs[0].url, "https://example.com/jobs/123");
});

test("extracts conservative job links as generic fallback", () => {
  const html = `
    <a href="/careers">Careers</a>
    <a href="/jobs/finance-manager">Finance Manager</a>
    <a href="/privacy">Privacy Policy</a>`;
  const jobs = parseJobLinks(html, "https://example.com");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Finance Manager");
  assert.equal(jobs[0].url, "https://example.com/jobs/finance-manager");
});

test("keeps missing jobs active for one scan before closing them", () => {
  const first = mergeStoredJobs([], [{ externalId: "1", title: "AE", location: "Dubai", department: "Sales", url: "https://x/jobs/1", postedAt: "" }], "2026-08-15T00:00:00.000Z");
  assert.equal(first[0].status, "active");
  const missedOnce = mergeStoredJobs(first, [], "2026-08-16T00:00:00.000Z");
  assert.equal(missedOnce[0].status, "active");
  assert.equal(missedOnce[0].missCount, 1);
  const missedTwice = mergeStoredJobs(missedOnce, [], "2026-08-17T00:00:00.000Z");
  assert.equal(missedTwice[0].status, "closed");
});

test("scores a hiring surge as high intent", () => {
  const score = calculateHiringScore({ activeJobs: 18, newJobs7d: 11, previousActiveJobs: 8, hasHrJobs: true, locationCount: 3 });
  assert.equal(score, 100);
  assert.equal(hiringStatus(score), "Hiring Surge");
});
