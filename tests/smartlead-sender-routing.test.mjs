import assert from "node:assert/strict";
import test from "node:test";
import { APPROVED_SENDING_DOMAINS, inspectSenderAccount, inspectSenderIdentity, OUTREACH_SENDER_NAME, senderDomain, senderProvider, senderRoute, senderInventory, validateApprovedSenderInventory, visibleSenderSignature } from "../src/lib/smartlead-sender-routing.ts";

test("Talentera and Evalufy domains never cross brands", () => {
  assert.equal(senderRoute({ from_email: "marita@jointalentera.com", smtp_host: "smtp.gmail.com" }).brand, "talentera");
  assert.equal(senderRoute({ from_email: "marita@getevalufy.com", smtp_host: "smtp.office365.com" }).brand, "evalify");
  assert.equal(senderRoute({ from_email: "marita@talentera.com", smtp_host: "smtp.gmail.com" }).brand, "unknown");
  assert.equal(senderRoute({ from_email: "marita@unrelated-example.com", smtp_host: "smtp.gmail.com" }).brand, "unknown");
});

test("Google and Microsoft providers are detected from mailbox metadata", () => {
  assert.equal(senderProvider({ smtp_host: "smtp.gmail.com", imap_host: "imap.gmail.com" }), "google");
  assert.equal(senderProvider({ smtp_host: "smtp.office365.com", imap_host: "outlook.office365.com" }), "microsoft");
  assert.equal(senderProvider({ provider: "Google OAuth" }), "google");
  assert.equal(senderProvider({ provider: "Microsoft Outlook OAuth" }), "microsoft");
});

test("sender domain never exposes the mailbox local part", () => {
  assert.equal(senderDomain("marita@jointalentera.com"), "jointalentera.com");
});

test("inventory groups by domain brand and provider", () => {
  const inventory = senderInventory([
    { from_email: "a@jointalentera.com", smtp_host: "smtp.gmail.com" },
    { from_email: "b@jointalentera.com", smtp_host: "smtp.gmail.com" },
    { from_email: "a@getevalufy.com", smtp_host: "smtp.office365.com" },
  ]);
  assert.deepEqual(inventory, [
    { domain: "getevalufy.com", brand: "evalify", provider: "microsoft", count: 1 },
    { domain: "jointalentera.com", brand: "talentera", provider: "google", count: 2 },
  ]);
});

test("mailbox safety fails closed unless SMTP, IMAP, warmup and daily limit are explicit", () => {
  const safe = inspectSenderAccount({ from_email: "a@jointalentera.com", is_smtp_success: true, is_imap_success: true, warmup_enabled: true, warmup_status: "active", max_email_per_day: 25 });
  assert.equal(safe.eligible, true);
  assert.equal(safe.capacity, 20);
  assert.equal(inspectSenderAccount({ from_email: "a@jointalentera.com", warmup_enabled: true, warmup_status: "active", max_email_per_day: 20 }).eligible, false);
  assert.equal(inspectSenderAccount({ from_email: "a@jointalentera.com", is_smtp_success: true, is_imap_success: true, max_email_per_day: 20 }).eligible, false);
  assert.equal(inspectSenderAccount({ from_email: "a@jointalentera.com", is_smtp_success: true, is_imap_success: true, warmup_enabled: true, warmup_status: "not_active", max_email_per_day: 20 }).eligible, false);
  assert.equal(inspectSenderAccount({ from_email: "a@talentera.com", is_smtp_success: true, is_imap_success: true, warmup_enabled: true, warmup_status: "active", max_email_per_day: 20 }).eligible, false);
});

test("official Smartlead email-account response fields are accepted", () => {
  const safe = inspectSenderAccount({
    id: 123,
    from_email: "a@jointalentera.com",
    type: "GMAIL",
    message_per_day: 50,
    is_smtp_success: true,
    is_imap_success: true,
    warmup_details: {
      status: "ACTIVE",
      warmup_reputation: "95%",
      blocked_reason: null,
    },
  });
  assert.equal(safe.eligible, true);
  assert.equal(safe.warmupKnown, true);
  assert.equal(safe.warmupEnabled, true);
  assert.equal(safe.dailyLimit, 50);
  assert.equal(safe.capacity, 20);
});

test("explicit disabled warmup overrides a stale active status", () => {
  const unsafe = inspectSenderAccount({
    from_email: "a@jointalentera.com",
    message_per_day: 50,
    is_smtp_success: true,
    is_imap_success: true,
    warmup_enabled: false,
    warmup_details: { status: "ACTIVE" },
  });
  assert.equal(unsafe.eligible, false);
  assert.match(unsafe.reasons.join(" "), /warmup/);
});

test("production inventory requires exactly three safe mailboxes on each of five approved domains", () => {
  const rows = [...APPROVED_SENDING_DOMAINS.talentera, ...APPROVED_SENDING_DOMAINS.evalify].flatMap((domain) =>
    Array.from({ length: 3 }, (_, index) => inspectSenderAccount({ from_email: `sender${index + 1}@${domain}`, is_smtp_success: true, is_imap_success: true, warmup_enabled: true, warmup_status: "active", max_email_per_day: 20 })),
  );
  assert.equal(validateApprovedSenderInventory(rows).healthy, true);
  rows[0] = { ...rows[0], eligible: false };
  assert.equal(validateApprovedSenderInventory(rows).healthy, false);
});

test("sender identity requires Marita's exact display name and no account-level signature", () => {
  assert.equal(OUTREACH_SENDER_NAME, "Marita Chedid");
  assert.equal(inspectSenderIdentity({ from_name: "Marita Chedid", signature: " " }).healthy, true);
  assert.equal(inspectSenderIdentity({ from_name: "Marita Chedid", signature: "<p><br></p>" }).healthy, true);
  assert.equal(inspectSenderIdentity({ from_name: "Marita", signature: "" }).healthy, false);
  assert.equal(inspectSenderIdentity({ from_name: "Marita Chedid", signature: "Sales Development Representative" }).healthy, false);
  assert.equal(visibleSenderSignature("<p>Marita&nbsp;Chedid</p>"), "Marita Chedid");
});
