import assert from "node:assert/strict";
import test from "node:test";
import {
  ACQUISITION_COVERAGE_COUNTRIES,
  ACQUISITION_COVERAGE_EMPLOYEE_RANGES,
  classifyCoverageSector,
  employeeCoverageTier,
  normalizeCoverageCountry,
} from "../src/lib/acquisition-market-coverage.ts";

test("covers the seven requested GCC and Egypt markets", () => {
  assert.deepEqual(ACQUISITION_COVERAGE_COUNTRIES, [
    "Saudi Arabia",
    "United Arab Emirates",
    "Qatar",
    "Kuwait",
    "Bahrain",
    "Oman",
    "Egypt",
  ]);
  assert.equal(normalizeCoverageCountry("KSA"), "Saudi Arabia");
  assert.equal(normalizeCoverageCountry("UAE"), "United Arab Emirates");
  assert.equal(normalizeCoverageCountry("Qatar"), "Qatar");
});

test("keeps discovery focused on the credit-efficient 251 to 50k pool", () => {
  assert.deepEqual(ACQUISITION_COVERAGE_EMPLOYEE_RANGES, [
    "251,500",
    "501,1000",
    "1001,2000",
    "2001,5000",
    "5001,10000",
    "10001,50000",
  ]);
  assert.equal(employeeCoverageTier(251), "sweet_pool");
  assert.equal(employeeCoverageTier(5000), "sweet_pool");
  assert.equal(employeeCoverageTier(5001), "enterprise_extension");
  assert.equal(employeeCoverageTier(50000), "enterprise_extension");
  assert.equal(employeeCoverageTier(250), "outside_default_pool");
});

test("government is a target sector instead of an automatic exclusion", () => {
  const result = classifyCoverageSector(
    "Saudi Arabia",
    "Ministry public authority government administration",
  );
  assert.equal(result.sector, "Government / Semi-Government");
  assert.equal(result.targeted, true);
  assert.equal(result.status, "eligible");
});

test("maps country-specific high-volume sectors and keeps unknowns for review", () => {
  const qatar = classifyCoverageSector("Qatar", "Energy oil gas company");
  assert.equal(qatar.sector, "Energy / Oil & Gas");
  assert.equal(qatar.status, "eligible");

  const egypt = classifyCoverageSector("Egypt", "BPO outsourcing contact center");
  assert.equal(egypt.sector, "BPO / Outsourcing");
  assert.equal(egypt.status, "eligible");

  const unknown = classifyCoverageSector("Oman", "Unclassified holding company");
  assert.equal(unknown.targeted, false);
  assert.equal(unknown.status, "review");
});
