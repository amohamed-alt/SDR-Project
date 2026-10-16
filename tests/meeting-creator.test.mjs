import assert from "node:assert/strict";
import test from "node:test";
import { scoreEvalufyAccount } from "../src/lib/evalufy-intelligence.ts";
import { scoreMeetingCreatorAccount } from "../src/lib/meeting-creator.ts";

test("Evalufy strongly scores a high-volume Saudi account with an enterprise ATS", () => {
  const result = scoreEvalufyAccount({
    name: "Example Retail",
    country: "Saudi Arabia",
    employeeCount: 2500,
    industry: "Retail",
    ats: "SAP SuccessFactors",
    activeJobs: 65,
    hrHeadcount: 18,
    topLocations: ["Riyadh", "Jeddah", "Dammam"],
    topDepartments: ["Talent Acquisition"],
  });

  assert.ok(result.score >= 80);
  assert.ok(result.integrationReadinessScore >= 95);
  assert.ok(result.assessmentNeedScore >= 80);
  assert.match(result.personas.primary, /Talent Acquisition/i);
});

test("Evalufy does not manufacture strong intent when hiring and ATS evidence are absent", () => {
  const result = scoreEvalufyAccount({
    name: "Quiet Company",
    country: "Saudi Arabia",
    employeeCount: 350,
    industry: "Professional Services",
    activeJobs: 0,
  });

  assert.ok(result.intentScore < 60);
  assert.ok(result.score < 75);
  assert.ok(result.risks.some((risk) => /No active hiring signal/i.test(risk)));
});

test("Meeting Creator routes enterprise-ATS mass hiring toward Evalufy", () => {
  const result = scoreMeetingCreatorAccount({
    name: "Scale Retail",
    country: "Saudi Arabia",
    employeeCount: 3000,
    industry: "Retail",
    ats: "Workday",
    activeJobs: 70,
    hrHeadcount: 20,
    topLocations: ["Riyadh", "Jeddah", "Khobar"],
    topDepartments: ["Talent Acquisition"],
  });

  assert.equal(result.recommendedProduct, "Evalufy");
  assert.ok(result.evalufyScore > result.talenteraScore);
  assert.ok(result.meetingScore >= result.evalufyScore);
});

test("Meeting Creator routes a greenfield recruiting workflow toward Talentera", () => {
  const result = scoreMeetingCreatorAccount({
    name: "Growing Operator",
    country: "Saudi Arabia",
    employeeCount: 1200,
    industry: "Construction",
    ats: "",
    activeJobs: 18,
    topLocations: ["Riyadh", "Jeddah"],
    topDepartments: ["Recruitment"],
  });

  assert.equal(result.recommendedProduct, "Talentera");
  assert.ok(result.talenteraScore >= result.evalufyScore);
  assert.match(result.productReason, /ATS modernization/i);
});
