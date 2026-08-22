import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppUrl,
  deterministicWhatsAppMessage,
  selectWhatsAppPhone,
  whatsappStyleForCountry,
} from "../src/lib/whatsapp-outreach.ts";

test("prefers a Saudi mobilephone over a landline phone", () => {
  const selected = selectWhatsAppPhone({
    country: "Saudi Arabia",
    mobilephone: "055 123 4567",
    phone: "011 234 5678",
  });
  assert.equal(selected?.phone, "+966551234567");
  assert.equal(selected?.source, "mobilephone");
  assert.equal(selected?.mobileLikely, true);
  assert.equal(selected?.alternatePhone, "+966112345678");
});

test("falls back to phone when mobilephone is missing", () => {
  const selected = selectWhatsAppPhone({
    country: "United Arab Emirates",
    phone: "+971 50 123 4567",
  });
  assert.equal(selected?.phone, "+971501234567");
  assert.equal(selected?.source, "phone");
  assert.equal(selected?.mobileLikely, true);
});

test("deduplicates the same number across both HubSpot properties", () => {
  const selected = selectWhatsAppPhone({
    country: "Saudi Arabia",
    mobilephone: "+966551234567",
    phone: "0551234567",
  });
  assert.equal(selected?.phone, "+966551234567");
  assert.equal(selected?.alternatePhone, undefined);
});

test("does not guess a country code for an ambiguous local number", () => {
  const selected = selectWhatsAppPhone({
    country: "",
    phone: "0551234567",
  });
  assert.equal(selected, null);
});

test("routes KSA and UAE to local professional styles", () => {
  assert.equal(whatsappStyleForCountry("KSA"), "saudi-ar");
  assert.equal(whatsappStyleForCountry("United Arab Emirates"), "emirati-ar");
  assert.equal(whatsappStyleForCountry("United Kingdom"), "english");
});

test("fallback copy only uses verified hiring as a hiring claim", () => {
  const withoutHiring = deterministicWhatsAppMessage({
    fullName: "Khalid Ahmed",
    company: "Example Co",
    title: "Head of Talent Acquisition",
    style: "saudi-ar",
    verifiedHiring: null,
  });
  assert.doesNotMatch(withoutHiring, /نشاط واضح بالتوظيف/);
  assert.match(withoutHiring, /بحكم دورك/);

  const withHiring = deterministicWhatsAppMessage({
    fullName: "Khalid Ahmed",
    company: "Example Co",
    title: "Head of Talent Acquisition",
    style: "saudi-ar",
    verifiedHiring: { activeJobs: 12, newJobs30d: 5 },
  });
  assert.match(withHiring, /نشاط واضح بالتوظيف/);
});

test("builds a wa.me link with encoded message text", () => {
  const url = buildWhatsAppUrl("966551234567", "السلام عليكم");
  assert.match(url, /^https:\/\/wa\.me\/966551234567\?text=/);
  assert.ok(url.includes(encodeURIComponent("السلام عليكم")));
});
