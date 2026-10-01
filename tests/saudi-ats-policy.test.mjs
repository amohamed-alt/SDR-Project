import test from "node:test";
import assert from "node:assert/strict";
import { atsProduct, careerMarkup, usablePhone, recentActivityBoost } from "../src/lib/saudi-ats-policy.ts";
const now = Date.parse("2026-10-01T12:00:00Z");
const evidence = { status: "detected", vendor: "Oracle Recruiting", careerUrl: "https://company.example/careers", evidenceUrl: "https://company.example/careers", reason: "Official apply link", checkedAt: new Date(now).toISOString() };
test("routing uses dated ATS evidence and holds unknowns", () => {
  assert.equal(atsProduct(evidence, now), "Evalufy");
  assert.equal(atsProduct({ ...evidence, status: "no_ats_observed", vendor: "" }, now), "Talentera");
  assert.equal(atsProduct({ ...evidence, status: "unknown" }, now), null);
  assert.equal(atsProduct({ ...evidence, evidenceUrl: "" }, now), null);
  assert.equal(atsProduct({ ...evidence, checkedAt: "2026-08-01" }, now), null);
});
test("official Oracle apply link is detected; ordinary vendor mentions are not", () => {
  assert.equal(careerMarkup('<a href="https://fa-example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_3">Apply</a>', evidence.careerUrl).vendor, "Oracle Recruiting");
  assert.equal(careerMarkup('We implement Oracle Recruiting and Workday', evidence.careerUrl).vendor, "");
  assert.equal(careerMarkup('<a href="https://oraclecloud.com.evil.example/careers">Apply</a>', evidence.careerUrl).vendor, "");
  assert.equal(careerMarkup('<a href="https://workday.com/partners">Partner</a>', 'https://company.example/').vendor, "");
});
test("an empty page or generic contact form is not no-ATS evidence", () => {
  assert.equal(careerMarkup('', evidence.careerUrl).direct, false);
  assert.equal(careerMarkup('<form><input name="email"></form>', evidence.careerUrl).direct, false);
  assert.equal(careerMarkup('<form><input type="file" name="resume"></form>', evidence.careerUrl).direct, true);
  assert.equal(careerMarkup('<a href="mailto:careers@company.example">Send CV</a>', evidence.careerUrl).direct, true);
});
test("phone availability gate rejects blanks and placeholders", () => {
  for (const phone of ["", "N/A", "123", "+00000000000"]) assert.equal(usablePhone(phone), false);
  assert.equal(usablePhone("+966 50 123 4567"), true);
});
test("recent posting is a dated LinkedIn priority signal, not an eligibility rule", () => {
  const signal = { kind: "linkedin_recent_post", sourceUrl: "https://www.linkedin.com/in/example", observedAt: new Date(now).toISOString() };
  assert.equal(recentActivityBoost(signal, now), 10);
  assert.equal(recentActivityBoost({ ...signal, observedAt: "2026-08-01" }, now), 0);
  assert.equal(recentActivityBoost({ ...signal, sourceUrl: "https://example.com" }, now), 0);
});
