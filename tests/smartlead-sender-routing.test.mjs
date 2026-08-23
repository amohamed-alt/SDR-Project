import assert from "node:assert/strict";
import test from "node:test";
import { senderDomain, senderProvider, senderRoute, senderInventory } from "../src/lib/smartlead-sender-routing.ts";

test("Talentera and Evalufy domains never cross brands", () => {
  assert.equal(senderRoute({ from_email: "marita@outreach.talentera.com", smtp_host: "smtp.gmail.com" }).brand, "talentera");
  assert.equal(senderRoute({ from_email: "marita@mail.evalufy.com", smtp_host: "smtp.office365.com" }).brand, "evalify");
  assert.equal(senderRoute({ from_email: "marita@unrelated-example.com", smtp_host: "smtp.gmail.com" }).brand, "unknown");
});

test("Google and Microsoft providers are detected from mailbox metadata", () => {
  assert.equal(senderProvider({ smtp_host: "smtp.gmail.com", imap_host: "imap.gmail.com" }), "google");
  assert.equal(senderProvider({ smtp_host: "smtp.office365.com", imap_host: "outlook.office365.com" }), "microsoft");
  assert.equal(senderProvider({ provider: "Google OAuth" }), "google");
  assert.equal(senderProvider({ provider: "Microsoft Outlook OAuth" }), "microsoft");
});

test("sender domain never exposes the mailbox local part", () => {
  assert.equal(senderDomain("marita@talentera-mail.com"), "talentera-mail.com");
});

test("inventory groups by domain brand and provider", () => {
  const inventory = senderInventory([
    { from_email: "a@talentera-mail.com", smtp_host: "smtp.gmail.com" },
    { from_email: "b@talentera-mail.com", smtp_host: "smtp.gmail.com" },
    { from_email: "a@evalufy-mail.com", smtp_host: "smtp.office365.com" },
  ]);
  assert.deepEqual(inventory, [
    { domain: "evalufy-mail.com", brand: "evalify", provider: "microsoft", count: 1 },
    { domain: "talentera-mail.com", brand: "talentera", provider: "google", count: 2 },
  ]);
});
