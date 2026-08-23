import assert from "node:assert/strict";
import test from "node:test";
import { checkPrimeforgeInfrastructure } from "../src/lib/primeforge-health.ts";
import { APPROVED_SENDING_DOMAINS } from "../src/lib/smartlead-sender-routing.ts";

const domains = [...APPROVED_SENDING_DOMAINS.talentera, ...APPROVED_SENDING_DOMAINS.evalify];

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function healthyFetch() {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/workspaces")) return response({ pagination: { total: 1 }, results: [{ id: "wks_1", name: "SDR" }] });
    if (url.pathname.endsWith("/domains")) return response({ results: domains.map((domain, index) => ({ id: `dom_${index}`, domain, status: "active", platform: index % 2 ? "microsoft" : "google" })) });
    if (url.pathname.endsWith("/mailboxes")) return response({ results: domains.flatMap((domain) => Array.from({ length: 3 }, (_, index) => ({ email: `sender${index + 1}@${domain}`, status: "active" }))) });
    if (/\/domains\/dom_\d+\/dns$/.test(url.pathname)) return response({ results: [
      { type: "TXT", name: "@", content: "v=spf1 include:_spf.google.com ~all" },
      { type: "TXT", name: "google._domainkey", content: "v=DKIM1; p=abcdefghijklmnopqrstuvwxyz1234567890" },
      { type: "TXT", name: "_dmarc", content: "v=DMARC1; p=none" },
    ] });
    return response({ error: "not found" }, 404);
  };
}

test("Primeforge preflight validates exact approved domain, DNS and mailbox inventory", async () => {
  const health = await checkPrimeforgeInfrastructure({ apiKey: "test-key", fetchImpl: healthyFetch() });
  assert.equal(health.healthy, true);
  assert.equal(health.readyMailboxes, 15);
  assert.equal(health.domains.length, 5);
  assert.ok(health.domains.every((domain) => domain.dns.spf && domain.dns.dkim && domain.dns.dmarc));
});

test("Primeforge preflight fails closed for a missing mailbox", async () => {
  const base = healthyFetch();
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/mailboxes")) {
      return response({ results: domains.flatMap((domain, domainIndex) => Array.from({ length: domainIndex === 0 ? 2 : 3 }, (_, index) => ({ email: `sender${index + 1}@${domain}`, status: "active" }))) });
    }
    return base(input, init);
  };
  const health = await checkPrimeforgeInfrastructure({ apiKey: "test-key", fetchImpl });
  assert.equal(health.healthy, false);
  assert.equal(health.readyMailboxes, 14);
  assert.match(health.warnings.join(" "), /jointalentera\.com: Mailbox inventory is 2\/3/);
});

test("Primeforge preflight never reports a missing API key as healthy", async () => {
  const health = await checkPrimeforgeInfrastructure({ apiKey: "" });
  assert.equal(health.configured, false);
  assert.equal(health.healthy, false);
  assert.match(health.warnings[0], /PRIMEFORGE_API_KEY/);
});
