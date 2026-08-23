import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppMobileUrl,
  buildWhatsAppUrl,
  buildWhatsAppWebUrl,
  deterministicWhatsAppMessage,
  humanizeWhatsAppMessage,
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

test("prefers an explicit HubSpot WhatsApp number over mobile and phone", () => {
  const selected = selectWhatsAppPhone({
    whatsappNumber: "+966 55 987 6543",
    mobilephone: "+966 55 123 4567",
    phone: "+966 11 555 1234",
    country: "Saudi Arabia",
  });
  assert.equal(selected?.source, "whatsapp_number");
  assert.equal(selected?.digits, "966559876543");
  assert.equal(selected?.alternatePhone, "+966551234567");
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

test("humanizer strips polished punctuation but keeps a natural question mark", () => {
  const message = humanizeWhatsAppMessage("السلام عليكم، أستاذ خالد. يعطيك العافية — بغيت أعرف: كيف ماشي عندكم الموضوع؟");
  assert.equal(message, "السلام عليكم أستاذ خالد يعطيك العافية بغيت أعرف كيف ماشي عندكم الموضوع؟");
  assert.doesNotMatch(message, /[،,.;؛:!…—–]/);
});

test("Saudi fallback sounds conversational and only uses verified hiring as a claim", () => {
  const withoutHiring = deterministicWhatsAppMessage({
    fullName: "محمد أحمد",
    company: "Example Co",
    title: "مدير التوظيف",
    style: "saudi-ar",
    verifiedHiring: null,
  });
  assert.match(withoutHiring, /السلام عليكم أستاذ محمد يعطيك العافية/);
  assert.match(withoutHiring, /بغيت أسألك/);
  assert.match(withoutHiring, /بحكم شغلك/);
  assert.doesNotMatch(withoutHiring, /شفت عندكم توظيف شغال هالفترة/);
  assert.doesNotMatch(withoutHiring, /Talentera تساعد فرق التوظيف ترتب/);
  assert.doesNotMatch(withoutHiring, /[،,.;؛:!…—–]/);

  const withHiring = deterministicWhatsAppMessage({
    fullName: "محمد أحمد",
    company: "Example Co",
    title: "مدير التوظيف",
    style: "saudi-ar",
    verifiedHiring: { activeJobs: 12, newJobs30d: 5 },
  });
  assert.match(withHiring, /شفت عندكم توظيف شغال هالفترة/);
  assert.match(withHiring, /بغيت أعرف/);
  assert.match(withHiring, /إذا ودك أرسل لك الفكرة باختصار/);
  assert.doesNotMatch(withHiring, /[،,.;؛:!…—–]/);
});

test("English fallback is chat-like rather than polished campaign copy", () => {
  const message = deterministicWhatsAppMessage({
    fullName: "Sarah Miller",
    company: "Example Co",
    title: "Talent Acquisition Director",
    style: "english",
    verifiedHiring: null,
  });
  assert.match(message, /Hi Sarah quick question/);
  assert.match(message, /screening and candidate follow-up/);
  assert.doesNotMatch(message, /streamline screening and follow-up/);
  assert.doesNotMatch(message, /[،,.;؛:!…—–]/);
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
