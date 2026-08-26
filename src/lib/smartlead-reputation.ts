export type ReputationSender = {
  email: string;
  maxPerDay: number;
  assigned: boolean;
  warmupEnabled: boolean;
  warmupKnown: boolean;
  brand: "talentera" | "evalify" | "unknown";
};

export type ReputationPlan = {
  eligibleSenders: number;
  assignedEligibleSenders: number;
  senderDailyCapacity: number;
  safeNewLeadCap: number;
  maxCampaignEmailsPerMailbox: number;
  touches: number;
};

export function isSafeTalenteraSender(sender: ReputationSender) {
  return sender.brand === "talentera" && sender.warmupKnown && sender.warmupEnabled;
}

export function calculateReputationPlan(
  senders: ReputationSender[],
  requestedNewLeadCap: number,
  options: { maxCampaignEmailsPerMailbox?: number; touches?: number } = {},
): ReputationPlan {
  const maxCampaignEmailsPerMailbox = Math.max(5, Math.min(30, Math.floor(options.maxCampaignEmailsPerMailbox || 20)));
  const touches = Math.max(1, Math.min(5, Math.floor(options.touches || 3)));
  const eligible = senders.filter(isSafeTalenteraSender);
  const assigned = eligible.filter((sender) => sender.assigned);
  const senderDailyCapacity = assigned.reduce((sum, sender) => {
    const accountLimit = sender.maxPerDay > 0 ? sender.maxPerDay : maxCampaignEmailsPerMailbox;
    return sum + Math.min(accountLimit, maxCampaignEmailsPerMailbox);
  }, 0);
  const steadyStateNewLeadCapacity = assigned.length ? Math.floor(senderDailyCapacity / touches) : 0;
  const requested = Math.max(0, Math.floor(Number(requestedNewLeadCap) || 0));
  return {
    eligibleSenders: eligible.length,
    assignedEligibleSenders: assigned.length,
    senderDailyCapacity,
    safeNewLeadCap: Math.min(requested, steadyStateNewLeadCapacity),
    maxCampaignEmailsPerMailbox,
    touches,
  };
}

export function bounceRate(sent: number, bounces: number) {
  const deliveredBase = Math.max(0, Math.floor(Number(sent) || 0));
  if (!deliveredBase) return 0;
  return Math.max(0, Number(bounces) || 0) / deliveredBase;
}

export function reputationHealth(sent: number, bounces: number, spamComplaints = 0) {
  const rate = bounceRate(sent, bounces);
  const spamRate = bounceRate(sent, spamComplaints);
  const enoughVolume = sent >= 50;
  const bounceUnsafe = enoughVolume && rate >= 0.02;
  const spamUnsafe = enoughVolume && spamRate >= 0.003;
  return {
    bounceRate: rate,
    spamRate,
    healthy: !bounceUnsafe && !spamUnsafe,
    reason: bounceUnsafe
      ? `Bounce rate ${(rate * 100).toFixed(1)}% is at or above the 2% safety threshold`
      : spamUnsafe
        ? `Spam complaint rate ${(spamRate * 100).toFixed(2)}% is at or above the 0.3% safety threshold`
        : "Bounce and spam complaint rates are within the configured safety thresholds",
  };
}

type CampaignLeadRow = Record<string, unknown>;

function rowObject(value: unknown): CampaignLeadRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as CampaignLeadRow : {};
}

function truthyFlag(value: unknown) {
  return value === true || value === 1 || /^(?:true|1|yes)$/i.test(String(value ?? "").trim());
}

function bouncedRow(row: CampaignLeadRow) {
  const lead = rowObject(row.lead);
  const flags = [
    row.is_bounced,
    row.is_bounce,
    row.has_bounced,
    row.is_sender_bounced,
    lead.is_bounced,
    lead.is_bounce,
    lead.has_bounced,
    lead.is_sender_bounced,
  ];
  if (flags.some(truthyFlag)) return true;
  const status = [row.email_status, row.lead_status, row.category, lead.email_status, lead.lead_status, lead.category]
    .map((value) => String(value ?? "").trim())
    .join(" ");
  return /(?:^|[_ -])bounc(?:e|ed)(?:$|[_ -])/i.test(status);
}

function leadEmail(row: CampaignLeadRow) {
  const lead = rowObject(row.lead);
  return String(row.email ?? lead.email ?? "").trim().toLowerCase();
}

export function uniqueBouncedLeadEmails(rows: CampaignLeadRow[]) {
  const emails = new Set<string>();
  for (const row of rows) {
    if (!bouncedRow(row)) continue;
    const email = leadEmail(row);
    if (email) emails.add(email);
  }
  return [...emails];
}

export function campaignReputationHealth(
  sent: number,
  rawBounceEvents: number,
  leadRows: CampaignLeadRow[],
  options: { minSent?: number; maxBounceRate?: number; minUniqueBounces?: number } = {},
) {
  const minSent = Math.max(1, Math.floor(options.minSent ?? 50));
  const maxBounceRate = Math.max(0, Number(options.maxBounceRate ?? 0.02));
  const minUniqueBounces = Math.max(1, Math.floor(options.minUniqueBounces ?? 3));
  const detectedEmails = uniqueBouncedLeadEmails(leadRows);
  const rawEvents = Math.max(0, Math.floor(Number(rawBounceEvents) || 0));
  const uniqueBounces = detectedEmails.length || rawEvents;
  const rate = bounceRate(sent, uniqueBounces);
  const enoughVolume = sent >= minSent;
  const enoughUniqueFailures = uniqueBounces >= minUniqueBounces;
  const unsafe = enoughVolume && enoughUniqueFailures && rate >= maxBounceRate;

  return {
    healthy: !unsafe,
    rawBounceEvents: rawEvents,
    uniqueBounces,
    duplicateBounceEvents: Math.max(0, rawEvents - uniqueBounces),
    uniqueBounceEmails: detectedEmails,
    bounceRate: rate,
    countSource: detectedEmails.length ? "campaign_leads" as const : "analytics_fallback" as const,
    reason: unsafe
      ? `${uniqueBounces} unique bounced recipients produced a ${(rate * 100).toFixed(1)}% deduplicated bounce rate`
      : "Unique-recipient bounce volume is below the campaign pause threshold",
  };
}
