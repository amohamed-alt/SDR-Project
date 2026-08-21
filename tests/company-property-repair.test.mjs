import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanyPropertyRepairs, normalizeCompanyDomain, propertiesToApply } from "../src/lib/company-property-repair.ts";

test("normalizes domain input safely", () => {
  assert.equal(normalizeCompanyDomain("https://www.Example.com/careers"), "example.com");
});

test("fills empty HubSpot properties but does not overwrite conflicts by default", () => {
  const repairs = buildCompanyPropertyRepairs({
    current: { domain: "example.com", career_page_url: "", detected_ats: "Workday" },
    suggested: { domain: "example.com", career_page_url: "https://example.com/careers", detected_ats: "Oracle Recruiting" },
    confidence: 97,
    evidence: "https://example.com/careers",
  });
  const properties = propertiesToApply(repairs, false);
  assert.equal(properties.career_page_url, "https://example.com/careers");
  assert.equal(properties.detected_ats, undefined);
});

test("allows explicit high-confidence conflict overwrite with evidence", () => {
  const repairs = buildCompanyPropertyRepairs({
    current: { detected_ats: "Workday" },
    suggested: { detected_ats: "Oracle Recruiting" },
    confidence: 96,
    evidence: "https://careers.example.com/jobs",
  });
  const properties = propertiesToApply(repairs, true);
  assert.equal(properties.detected_ats, "Oracle Recruiting");
});

test("does not overwrite conflicts below 95 percent even when override is requested", () => {
  const repairs = buildCompanyPropertyRepairs({
    current: { detected_ats: "Workday" },
    suggested: { detected_ats: "Oracle Recruiting" },
    confidence: 94,
    evidence: "https://careers.example.com/jobs",
  });
  assert.equal(propertiesToApply(repairs, true).detected_ats, undefined);
});
