import assert from "node:assert/strict";
import test from "node:test";
import { domainsMatch, emailMatchesCompanyDomain, normalizeCompanyDomain } from "../src/lib/email-domain-policy.ts";

test("matches current-company email domains including safe subdomains", () => {
  assert.equal(emailMatchesCompanyDomain("person@company.com", "https://www.company.com/careers"), true);
  assert.equal(emailMatchesCompanyDomain("person@people.company.com", "company.com"), true);
  assert.equal(domainsMatch("careers.company.com", "company.com"), true);
});

test("rejects former-company and personal email domains", () => {
  assert.equal(emailMatchesCompanyDomain("person@old-company.com", "company.com"), false);
  assert.equal(emailMatchesCompanyDomain("person@gmail.com", "company.com"), false);
  assert.equal(emailMatchesCompanyDomain("person@company.co", "company.com"), false);
  assert.equal(normalizeCompanyDomain(""), "");
});
