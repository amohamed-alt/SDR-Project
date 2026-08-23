import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseSenderForProduct,
  decideRecipientLanguage,
  recommendedProduct,
  senderBrand,
} from "../src/lib/recipient-language-routing.ts";

test("Arabic-script Saudi name stays Arabic and unchanged", () => {
  const result = decideRecipientLanguage({ firstName: "عبدالله", country: "Saudi Arabia" });
  assert.equal(result.locale, "ar-SA");
  assert.equal(result.greetingName, "عبدالله");
  assert.equal(result.translated, false);
  assert.equal(result.confidence, 1);
});

test("high-confidence Arabic Latin name is safely mapped in KSA", () => {
  const result = decideRecipientLanguage({ firstName: "Abdullah", country: "Saudi Arabia" });
  assert.equal(result.locale, "ar-SA");
  assert.equal(result.greetingName, "عبدالله");
  assert.equal(result.translated, true);
  assert.ok(result.confidence >= 0.95);
});

test("common Saudi/Gulf Latin transliterations from the live queue map safely", () => {
  const samples = {
    Maher: "ماهر",
    Tamim: "تميم",
    Hattan: "هتان",
    Hisham: "هشام",
    Hesham: "هشام",
    Ammar: "عمار",
    Nabil: "نبيل",
    Mohamed: "محمد",
  };
  for (const [firstName, expected] of Object.entries(samples)) {
    const result = decideRecipientLanguage({ firstName, country: "Saudi Arabia" });
    assert.equal(result.locale, "ar-SA", firstName);
    assert.equal(result.greetingName, expected, firstName);
    assert.ok(result.confidence >= 0.95, firstName);
  }
});

test("Mohammed in UAE gets Gulf Arabic and Arabic greeting name", () => {
  const result = decideRecipientLanguage({ firstName: "Mohammed", country: "United Arab Emirates" });
  assert.equal(result.locale, "ar-GCC");
  assert.equal(result.greetingName, "محمد");
});

test("non-Arabic Latin name in Saudi Arabia falls back to English", () => {
  const result = decideRecipientLanguage({ firstName: "John", country: "Saudi Arabia" });
  assert.equal(result.locale, "en");
  assert.equal(result.greetingName, "John");
  assert.equal(result.translated, false);
});

test("South Asian Latin name in KSA is not incorrectly Arabized", () => {
  const result = decideRecipientLanguage({ firstName: "Priya", country: "KSA" });
  assert.equal(result.locale, "en");
  assert.equal(result.greetingName, "Priya");
});

test("ambiguous international name is deliberately not in the Arabic map", () => {
  for (const firstName of ["Sarah", "Adam", "Sam", "Maya", "George"]) {
    const result = decideRecipientLanguage({ firstName, country: "Saudi Arabia" });
    assert.equal(result.locale, "en", firstName);
    assert.equal(result.greetingName, firstName);
  }
});

test("explicit English always wins even for an Arabic-script name", () => {
  const result = decideRecipientLanguage({ firstName: "محمد", country: "Saudi Arabia", explicitLanguage: "en" });
  assert.equal(result.locale, "en");
  assert.equal(result.greetingName, "محمد");
});

test("explicit Arabic with an ambiguous Latin name fails safe to English", () => {
  const result = decideRecipientLanguage({ firstName: "Alex", country: "Saudi Arabia", explicitLanguage: "ar" });
  assert.equal(result.locale, "en");
  assert.equal(result.greetingName, "Alex");
  assert.ok(result.reason.includes("safe English fallback"));
});

test("missing first name never invents an Arabic name", () => {
  const result = decideRecipientLanguage({ firstName: "", fullName: "", country: "Saudi Arabia" });
  assert.equal(result.locale, "en");
  assert.equal(result.greetingName, "");
  assert.equal(result.translated, false);
});

test("full name can safely provide the first token when firstname is missing", () => {
  const result = decideRecipientLanguage({ fullName: "Abdulaziz Alqahtani", country: "Saudi Arabia" });
  assert.equal(result.locale, "ar-SA");
  assert.equal(result.greetingName, "عبدالعزيز");
});

test("Talentera and Evalify sender brands are kept separate", () => {
  assert.equal(senderBrand("marita@talentera.com"), "talentera");
  assert.equal(senderBrand("marita@campaign.evalufy.com"), "evalify");
  assert.equal(senderBrand("marita@evalify.com"), "evalify");
  assert.equal(senderBrand("marita@example.com"), "unknown");
  assert.equal(canUseSenderForProduct("marita@talentera.com", "talentera"), true);
  assert.equal(canUseSenderForProduct("marita@evalufy.com", "talentera"), false);
  assert.equal(canUseSenderForProduct("marita@evalufy.com", "evalify"), true);
});

test("Evalify is selected only when assessment intent is verified or explicit", () => {
  assert.equal(recommendedProduct({ assessmentSignal: true }).product, "evalify");
  assert.equal(recommendedProduct({ atsOpportunity: true }).product, "talentera");
  assert.equal(recommendedProduct({}).product, "talentera");
  assert.equal(recommendedProduct({ explicitProduct: "evalify" }).product, "evalify");
});
