import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("replaces a deliverable former-company email with a verified current-company work email", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sdr-current-work-email-"));
  const originalFetch = globalThis.fetch;
  const previousEnvironment = {
    SIGNALHIRE_API_KEY: process.env.SIGNALHIRE_API_KEY,
    HUBSPOT_PRIVATE_APP_TOKEN: process.env.HUBSPOT_PRIVATE_APP_TOKEN,
    MILLIONVERIFIER_CACHE_PATH: process.env.MILLIONVERIFIER_CACHE_PATH,
    OUTREACH_VERIFICATION_HISTORY_PATH: process.env.OUTREACH_VERIFICATION_HISTORY_PATH,
  };
  const verifiedEmails = [];
  const hubSpotWrites = [];

  process.env.SIGNALHIRE_API_KEY = "signalhire-test";
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "hubspot-test";
  process.env.MILLIONVERIFIER_CACHE_PATH = join(directory, "cache.json");
  process.env.OUTREACH_VERIFICATION_HISTORY_PATH = join(directory, "history.json");

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://api.millionverifier.com/")) {
      const email = new URL(url).searchParams.get("email");
      verifiedEmails.push(email);
      return Response.json({ result: "ok", credits: 999 });
    }
    if (url === "https://www.signalhire.com/api/v1/candidate/search") {
      return Response.json([{
        status: "success",
        candidate: {
          uid: "candidate-current",
          social: [{ type: "li", link: "https://www.linkedin.com/in/current-person", rating: 95 }],
          experience: [{ company: "New Company", website: "https://new-company.com", current: true }],
          contacts: [
            { type: "email", value: "person@old-company.com", subType: "work", rating: 99 },
            { type: "email", value: "person@new-company.com", subType: "work", rating: 90 },
            { type: "email", value: "person@gmail.com", subType: "personal", rating: 95 },
          ],
        },
      }], { headers: { "x-credits-left": "50" } });
    }
    if (url.startsWith("https://api.hubapi.com/crm/v3/objects/contacts/")) {
      hubSpotWrites.push(JSON.parse(String(init.body)).properties);
      return Response.json({ id: "contact-current" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const moduleUrl = new URL(`../src/lib/outreach-email-waterfall.ts?test=${Date.now()}`, import.meta.url);
    const { runOutreachEmailWaterfall } = await import(moduleUrl.href);
    const result = await runOutreachEmailWaterfall([{
      contactId: "contact-current",
      email: "person@old-company.com",
      linkedinUrl: "https://www.linkedin.com/in/current-person",
      fullName: "Current Person",
      companyName: "New Company",
      domain: "new-company.com",
    }], 1, { millionVerifierApiKey: "millionverifier-test", buffer: 0 });

    assert.deepEqual(verifiedEmails, ["person@old-company.com", "person@new-company.com"]);
    assert.deepEqual(result.sendableEmails, ["person@new-company.com"]);
    assert.equal(result.replacements, 1);
    assert.deepEqual(hubSpotWrites.at(-1), {
      email: "person@new-company.com",
      gtm_email_status: "valid",
      gtm_email_type: "work",
      email_enrichment_status: "work_email_found",
      signalhire_match_status: "success",
      signalhire_uid: "candidate-current",
      signalhire_last_enriched_at: new Date().toISOString().slice(0, 10),
      gtm_last_enriched_at: new Date().toISOString().slice(0, 10),
      work_email: "person@new-company.com",
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
