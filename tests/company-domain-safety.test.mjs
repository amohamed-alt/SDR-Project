import assert from "node:assert/strict";
import test from "node:test";
import {
  isThirdPartyCompanyDomain,
  safeCompanyDomain,
  safeCompanyWebsite,
} from "../src/lib/company-domain-safety.ts";

test("rejects Wuzzuf as another company's identity", () => {
  assert.equal(isThirdPartyCompanyDomain("https://wuzzuf.net/jobs/careers/AJi-Group-Egypt", "AJi Group of Companies"), true);
  assert.equal(safeCompanyDomain("https://wuzzuf.net/jobs/careers/AJi-Group-Egypt", "AJi Group of Companies"), "");
  assert.equal(safeCompanyWebsite("https://wuzzuf.net/jobs/careers/AJi-Group-Egypt", "AJi Group of Companies"), "");
});

test("rejects other recruitment marketplaces and profile aggregators", () => {
  assert.equal(isThirdPartyCompanyDomain("https://www.bayt.com/en/company/acme", "Acme Holdings"), true);
  assert.equal(isThirdPartyCompanyDomain("https://www.linkedin.com/company/acme", "Acme Holdings"), true);
  assert.equal(isThirdPartyCompanyDomain("https://www.indeed.com/cmp/acme", "Acme Holdings"), true);
});

test("keeps genuine company websites", () => {
  assert.equal(isThirdPartyCompanyDomain("https://aji-group.com/careers", "AJi Group of Companies"), false);
  assert.equal(safeCompanyDomain("https://aji-group.com/careers", "AJi Group of Companies"), "aji-group.com");
  assert.equal(safeCompanyWebsite("aji-group.com", "AJi Group of Companies"), "https://aji-group.com");
});

test("allows the platform when it is actually the target company", () => {
  assert.equal(isThirdPartyCompanyDomain("https://wuzzuf.net", "Wuzzuf"), false);
  assert.equal(isThirdPartyCompanyDomain("https://bayt.com", "Bayt"), false);
});
