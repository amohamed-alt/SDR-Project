import assert from "node:assert/strict";
import test from "node:test";
import { saudi200Candidate, saudiPolicyExcluded } from "../src/lib/saudi-inventory-policy.ts";

test("Saudi inventory includes exactly 200 and companies above the old 50,000 ceiling", () => {
  assert.equal(saudi200Candidate("Saudi Arabia", 200), true);
  assert.equal(saudi200Candidate("Saudi Arabia", 150000), true);
  assert.equal(saudi200Candidate("Saudi Arabia", 199), false);
  assert.equal(saudi200Candidate("United Arab Emirates", 1000), false);
  assert.equal(saudi200Candidate("Saudi Arabia", 0), true);
});

test("government domains and job pages cannot enter the prospecting queue", () => {
  assert.equal(saudiPolicyExcluded("pif.gov.sa", "Public Investment Fund"), true);
  assert.equal(saudiPolicyExcluded("example.com", "وظائف السعودية"), true);
  assert.equal(saudiPolicyExcluded("example.com", "Job vacancies in Saudi Arabia"), true);
  assert.equal(saudiPolicyExcluded("example.com", "Manufacturing and retail group"), false);
});
