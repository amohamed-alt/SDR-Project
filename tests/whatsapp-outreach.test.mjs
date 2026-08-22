import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppMobileUrl,
  buildWhatsAppUrl,
  buildWhatsAppWebUrl,
  deterministicWhatsAppMessage,
  selectWhatsAppPhone,
  whatsappFallbackStyle,
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

test("routes KSA and UAE market styles correctly", () => {
  assert.equal(whatsappStyleForCountry("KSA"), "saudi-ar");
  assert.equal(whatsappStyleForCountry("United Arab Emirates"), "emirati-ar");
  assert.equal(whatsappStyleForCountry("United Kingdom"), "english");
});

test("conservative fallback keeps Latin-script profiles in English even in KSA", () => {
  assert.equal(whatsappFallbackStyle({
    country: "Saudi Arabia",
    fullName: "Abdul Rehman",
    title: "Software Engineering Recruiter",
  }), "english");
});

test("conservative fallback uses Saudi Arabic when explicit Arabic script is present", () => {
  assert.equal(whatsappFallbackStyle({
    country: "Saudi Arabia",
    fullName: "محمد القحطاني",
    title: "مدير استقطاب المواهب",
  }), "saudi-ar");
});

test("fallback copy only uses verified hiring as a hiring claim", () => {
  const withoutHiring = deterministicWhatsAppMessage({
    fullName: "محمد أحمد",
    company: "Example Co",
    title: "مدير التوظيف",
    style: "saudi-ar",
    verifiedHiring: null,
  });
  assert.doesNotMatch(withoutHiring, /حركة توظيف الفترة هذي/);
  assert.match(withoutHiring, /بحكم شغلك/);

  const withHiring = deterministicWhatsAppMessage({
    fullName: "محمد أحمد",
    company: "Example Co",
    title: "مدير التوظيف",
    style: "saudi-ar",
    verifiedHiring: { activeJobs: 12, newJobs30d: 5 },
  });
  assert.match(withHiring, /حركة توظيف الفترة هذي/);
});

test("builds a direct WhatsApp Web link with encoded message text", () => {
  const url = buildWhatsAppWebUrl("966551234567", "السلام عليكم");
  assert.match(url, /^https:\/\/web\.whatsapp\.com\/send\?phone=966551234567&text=/);
  assert.ok(url.includes(encodeURIComponent("السلام عليكم")));
  assert.equal(buildWhatsAppUrl("966551234567", "السلام عليكم"), url);
});

test("builds a wa.me mobile link separately", () => {
  const url = buildWhatsAppMobileUrl("966551234567", "Hello");
  assert.match(url, /^https:\/\/wa\.me\/966551234567\?text=/);
});
