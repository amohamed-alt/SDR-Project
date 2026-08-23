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
