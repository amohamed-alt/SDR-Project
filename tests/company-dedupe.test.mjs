import assert from "node:assert/strict";
import test from "node:test";
import { compatibleCompanyIdentity, normalizedCompanyName } from "../src/lib/company-dedupe.ts";

test("company name fallback handles harmless legal suffix differences", () => {
  assert.equal(normalizedCompanyName("Acme Holdings LLC"), "acme");
  assert.equal(compatibleCompanyIdentity({
    requestedName: "Acme Holdings LLC",
    requestedDomain: "acme.sa",
    existingName: "Acme",
    existingDomain: "www.acme.sa",
  }), true);
});

test("company name fallback never merges conflicting domains", () => {
  assert.equal(compatibleCompanyIdentity({
    requestedName: "United Group",
    requestedDomain: "united-one.com",
    existingName: "United Group",
    existingDomain: "united-two.com",
  }), false);
});
