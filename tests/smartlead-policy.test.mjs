import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCoverage,
  emailStatusIsSafe,
  industryBucket,
  isValidBusinessEmail,
  localeForCountry,
  personaBucket,
  renderOutreachTemplate,
  safeOpeningLineForLocale,
  sanitizeOutreachText,
} from "../src/lib/smartlead-policy.ts";

test("Saudi contacts route to Saudi Arabic", () => {
  assert.equal(localeForCountry("Saudi Arabia"), "ar-SA");
  assert.equal(localeForCountry("KSA"), "ar-SA");
  assert.equal(localeForCountry("United Arab Emirates"), "ar-GCC");
  assert.equal(localeForCountry("Egypt"), "en");
});

test("industry and persona routing are deterministic", () => {
  assert.equal(industryBucket("Hospitals and Health Care"), "healthcare");
  assert.equal(industryBucket("Retail"), "retail");
  assert.equal(personaBucket("Head of Talent Acquisition"), "ta-leader");
  assert.equal(personaBucket("HR Director"), "hr-leader");
});

test("email policy rejects unsafe addresses and statuses", () => {
  assert.equal(isValidBusinessEmail("person@company.com"), true);
  assert.equal(isValidBusinessEmail("noreply@company.com"), false);
  assert.equal(isValidBusinessEmail("not-an-email"), false);
  assert.equal(emailStatusIsSafe("verified"), true);
  assert.equal(emailStatusIsSafe("Bounced"), false);
  assert.equal(emailStatusIsSafe("do not contact"), false);
});

test("coverage shows today, tomorrow and queue days", () => {
  assert.deepEqual(calculateCoverage(184, 75), {
    dailyNewCap: 75,
    ready: 184,
    today: 75,
    tomorrow: 75,
    next48Hours: 150,
    coverageDays: 2.5,
  });
});

test("copy rendering removes links and replaces approved placeholders", () => {
  const rendered = renderOutreachTemplate("Hi {first_name} at {company_name}", { first_name: "Sara", company_name: "Acme" });
  assert.equal(rendered, "Hi Sara at Acme");
  assert.equal(sanitizeOutreachText("Hello https://example.com world", 100), "Hello world");
});

test("AI opening lines cannot mix Arabic and English campaign scripts", () => {
  assert.equal(safeOpeningLineForLocale("فرق التوظيف تحتاج مسارا أوضح.", "ar-SA"), "فرق التوظيف تحتاج مسارا أوضح.");
  assert.equal(safeOpeningLineForLocale("Your hiring team needs a cleaner flow.", "ar-SA"), "");
  assert.equal(safeOpeningLineForLocale("فريق Talentera يحتاج مسارا أوضح.", "ar-GCC"), "");
  assert.equal(safeOpeningLineForLocale("Your hiring team needs a cleaner flow.", "en"), "Your hiring team needs a cleaner flow.");
  assert.equal(safeOpeningLineForLocale("فريق التوظيف يحتاج مسارا أوضح.", "en"), "");
});
