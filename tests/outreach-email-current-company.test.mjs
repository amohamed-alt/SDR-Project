import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("bypasses a recent persisted result and freshly verifies every send candidate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sdr-fresh-mv-send-gate-"));
  const originalFetch = globalThis.fetch;
  const previousEnvironment = {
    SIGNALHIRE_API_KEY: process.env.SIGNALHIRE_API_KEY,
    HUBSPOT_PRIVATE_APP_TOKEN: process.env.HUBSPOT_PRIVATE_APP_TOKEN,
    MILLIONVERIFIER_CACHE_PATH: process.env.MILLIONVERIFIER_CACHE_PATH,
    OUTREACH_VERIFICATION_HISTORY_PATH: process.env.OUTREACH_VERIFICATION_HISTORY_PATH,
  };
  const cachePath = join(directory, "cache.json");
  const hubSpotWrites = [];
  let millionVerifierCalls = 0;

  process.env.SIGNALHIRE_API_KEY = "signalhire-test";
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "hubspot-test";
  process.env.MILLIONVERIFIER_CACHE_PATH = cachePath;
  process.env.OUTREACH_VERIFICATION_HISTORY_PATH = join(directory, "history.json");
  await writeFile(cachePath, JSON.stringify({
    version: 1,
    entries: [{ email: "person@current-company.com", status: "valid", checkedAt: new Date().toISOString(), quality: "good", subresult: "" }],
  }));

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://api.millionverifier.com/")) {
      millionVerifierCalls += 1;
      return Response.json({ result: "invalid", credits: 998 });
    }
    if (url === "https://www.signalhire.com/api/v1/candidate/search") {
      return Response.json([{
        status: "success",
        candidate: {
          uid: "candidate-current",
          social: [{ type: "li", link: "https://www.linkedin.com/in/current-person", rating: 95 }],
          experience: [{ company: "Current Company", website: "https://current-company.com", current: true }],
          contacts: [],
        },
      }]);
    }
    if (url.startsWith("https://api.hubapi.com/crm/v3/objects/contacts/")) {
      hubSpotWrites.push(JSON.parse(String(init.body)).properties);
      return Response.json({ id: "contact-current" });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const moduleUrl = new URL(`../src/lib/outreach-email-waterfall.ts?fresh=${Date.now()}`, import.meta.url);
    const { runOutreachEmailWaterfall } = await import(moduleUrl.href);
    const result = await runOutreachEmailWaterfall([{
      contactId: "contact-current",
      email: "person@current-company.com",
      linkedinUrl: "https://www.linkedin.com/in/current-person",
      fullName: "Current Person",
      companyName: "Current Company",
      domain: "current-company.com",
    }], 1, { millionVerifierApiKey: "millionverifier-test", buffer: 0 });

    assert.equal(millionVerifierCalls, 1);
    assert.equal(result.millionVerifierChecks, 1);
    assert.equal(result.millionVerifierCacheHits, 0);
    assert.deepEqual(result.sendableEmails, []);
    assert.equal(hubSpotWrites.at(-1).gtm_email_status, "invalid");
    assert.equal(hubSpotWrites.at(-1).gtm_last_enriched_at, new Date().toISOString().slice(0, 10));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed when a fresh valid status cannot be persisted to HubSpot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sdr-fresh-mv-hubspot-gate-"));
  const originalFetch = globalThis.fetch;
  const previousEnvironment = {
    SIGNALHIRE_API_KEY: process.env.SIGNALHIRE_API_KEY,
    HUBSPOT_PRIVATE_APP_TOKEN: process.env.HUBSPOT_PRIVATE_APP_TOKEN,
    MILLIONVERIFIER_CACHE_PATH: process.env.MILLIONVERIFIER_CACHE_PATH,
    OUTREACH_VERIFICATION_HISTORY_PATH: process.env.OUTREACH_VERIFICATION_HISTORY_PATH,
  };

  process.env.SIGNALHIRE_API_KEY = "signalhire-test";
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "hubspot-test";
  process.env.MILLIONVERIFIER_CACHE_PATH = join(directory, "cache.json");
  process.env.OUTREACH_VERIFICATION_HISTORY_PATH = join(directory, "history.json");

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.millionverifier.com/")) return Response.json({ result: "ok", credits: 997 });
    if (url.startsWith("https://api.hubapi.com/crm/v3/objects/contacts/")) return new Response("temporary HubSpot failure", { status: 503 });
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const moduleUrl = new URL(`../src/lib/outreach-email-waterfall.ts?hubspot=${Date.now()}`, import.meta.url);
    const { runOutreachEmailWaterfall } = await import(moduleUrl.href);
    const result = await runOutreachEmailWaterfall([{
      contactId: "contact-current",
      email: "person@current-company.com",
      linkedinUrl: "https://www.linkedin.com/in/current-person",
      fullName: "Current Person",
      companyName: "Current Company",
      domain: "current-company.com",
    }], 1, { millionVerifierApiKey: "millionverifier-test", buffer: 0 });

    assert.deepEqual(result.sendableEmails, []);
    assert.equal(result.validCurrent, 0);
    assert.equal(result.noValidEmail, 1);
    assert.equal(result.errors, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("marks historical MillionVerifier results as needing a fresh check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sdr-stale-mv-visibility-"));
  const previousEnvironment = {
    MILLIONVERIFIER_CACHE_PATH: process.env.MILLIONVERIFIER_CACHE_PATH,
    OUTREACH_VERIFICATION_HISTORY_PATH: process.env.OUTREACH_VERIFICATION_HISTORY_PATH,
  };
  const cachePath = join(directory, "cache.json");
  process.env.MILLIONVERIFIER_CACHE_PATH = cachePath;
  process.env.OUTREACH_VERIFICATION_HISTORY_PATH = join(directory, "history.json");
  await writeFile(cachePath, JSON.stringify({
    version: 1,
    entries: [{ email: "person@current-company.com", status: "valid", checkedAt: "2026-08-01T00:00:00.000Z", quality: "good", subresult: "" }],
  }));

  try {
    const moduleUrl = new URL(`../src/lib/outreach-email-waterfall.ts?stale=${Date.now()}`, import.meta.url);
    const { getOutreachVerificationSnapshot } = await import(moduleUrl.href);
    const snapshot = await getOutreachVerificationSnapshot([{ contactId: "contact-current", email: "person@current-company.com" }]);
    assert.equal(snapshot.get("contact-current").status, "stale");
    assert.equal(snapshot.get("contact-current").cacheFresh, false);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
