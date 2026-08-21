import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreTalenteraAccount,
  scoreTalenteraPortfolio,
} from "../src/lib/talentera-intelligence.ts";

test("ranks a Saudi hiring surge with HR systems investment as a Tier A account", () => {
  const account = scoreTalenteraAccount({
    companyId: "1",
    name: "Example Saudi Enterprise",
    domain: "example.sa",
    country: "Saudi Arabia",
    employeeCount: 3500,
    ats: "Oracle Recruiting Cloud",
    activeJobs: 84,
    previousActiveJobs: 42,
    newJobs7d: 16,
    newJobs30d: 39,
    hiringScore: 96,
    topLocations: ["Riyadh", "Jeddah", "Dammam", "NEOM"],
    topDepartments: ["Technology", "Operations", "People"],
    jobs: [
      { title: "HRIS Manager", location: "Riyadh", department: "Human Resources" },
      { title: "Senior Recruiter", location: "Jeddah", department: "Talent Acquisition" },
    ],
  });

  assert.equal(account.tier, "A");
  assert.ok(account.score >= 78);
  assert.equal(account.intentLevel, "Very High");
  assert.equal(account.hiringVelocity, "Surging");
  assert.equal(account.languageRoute, "Arabic-first bilingual");
  assert.equal(account.personas.primary, "HRIS / HR Systems Manager");
  assert.equal(account.competitorMotion.family, "enterprise-suite");
  assert.ok(account.signals.some((signal) => signal.key === "hr-systems"));
  assert.ok(account.signals.some((signal) => signal.key === "hiring-surge"));
});

test("does not fabricate a replacement claim when ATS is unknown", () => {
  const account = scoreTalenteraAccount({
    name: "Unknown ATS Company",
    country: "United Arab Emirates",
    activeJobs: 18,
    previousActiveJobs: 15,
    newJobs7d: 2,
    newJobs30d: 7,
    hiringScore: 54,
    topLocations: ["Dubai", "Abu Dhabi"],
  });

  assert.equal(account.competitorMotion.family, "greenfield");
  assert.equal(account.competitorMotion.currentSystem, "No ATS confidently detected");
  assert.ok(account.risks.some((risk) => risk.includes("ATS is not confidently detected")));
  assert.ok(account.nextActions.some((action) => action.includes("Confirm the current ATS")));
});

test("routes UAE outreach as English-first bilingual", () => {
  const account = scoreTalenteraAccount({
    name: "UAE Company",
    country: "United Arab Emirates",
    ats: "Greenhouse",
    activeJobs: 32,
    previousActiveJobs: 30,
    newJobs30d: 12,
    hiringScore: 68,
  });

  assert.equal(account.languageRoute, "English-first bilingual");
  assert.equal(account.competitorMotion.family, "modern-ats");
  assert.ok(account.recommendedChannels.includes("Email"));
});

test("detects recruiting-team investment and selects Talent Acquisition leadership", () => {
  const account = scoreTalenteraAccount({
    name: "Growing Employer",
    country: "Saudi Arabia",
    activeJobs: 27,
    previousActiveJobs: 22,
    newJobs30d: 9,
    hiringScore: 66,
    jobs: [{ title: "Senior Talent Acquisition Specialist", department: "People" }],
  });

  assert.ok(account.signals.some((signal) => signal.key === "ta-team"));
  assert.equal(account.personas.primary, "Head / Director of Talent Acquisition");
  assert.match(account.recommendedAngle, /Recruitment-team investment/i);
});

test("normalizes fit across available evidence instead of treating missing employee count as zero fit", () => {
  const withoutEmployeeCount = scoreTalenteraAccount({
    name: "No Size Data",
    country: "Saudi Arabia",
    ats: "Workday",
    activeJobs: 45,
    previousActiveJobs: 30,
    newJobs30d: 18,
    hiringScore: 82,
    topLocations: ["Riyadh", "Jeddah", "Dammam"],
  });

  assert.ok(withoutEmployeeCount.fitScore >= 50);
  assert.ok(withoutEmployeeCount.risks.some((risk) => risk.includes("Employee count is missing")));
});

test("portfolio ranking places stronger fit and timing first", () => {
  const portfolio = scoreTalenteraPortfolio([
    {
      companyId: "low",
      name: "Low Signal",
      country: "United Arab Emirates",
      activeJobs: 2,
      previousActiveJobs: 2,
      newJobs30d: 0,
      hiringScore: 20,
    },
    {
      companyId: "high",
      name: "High Signal",
      country: "Saudi Arabia",
      ats: "SAP SuccessFactors",
      activeJobs: 70,
      previousActiveJobs: 40,
      newJobs7d: 12,
      newJobs30d: 28,
      hiringScore: 93,
      topLocations: ["Riyadh", "Jeddah", "Dammam"],
      jobs: [{ title: "Recruitment Operations Manager" }],
    },
  ]);

  assert.equal(portfolio[0].companyId, "high");
  assert.ok(portfolio[0].score > portfolio[1].score);
});
