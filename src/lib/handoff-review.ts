export const HANDOFF_START_DATE = "2026-07-13";
export type FollowUpEvent = {
  id: string;
  type: "Call" | "Email" | "WhatsApp" | "Meeting";
  at: string;
  detail: string;
  outcome: string;
  connected: boolean;
  url: string;
};
export type HandoffReview = {
  eligible: boolean;
  state: "upcoming" | "excluded" | "outcome-missing" | "within-sla" | "reviewable" | "closed" | "unlinked";
  noFollowUp: boolean;
  noCallAttempts: boolean;
  noConnectedCall: boolean;
  noNextTask: boolean;
  overdueTask: boolean;
  callAttempts: number;
  connectedCalls: number;
  events: FollowUpEvent[];
};

export function reviewHandoff(input: {
  endAt: string; outcome: string; events: FollowUpEvent[]; linked: boolean;
  closed: boolean; nextTask: boolean; overdueTask: boolean;
}, now = Date.now()): HandoffReview {
  const end = Date.parse(input.endAt);
  const events = input.events.filter(event => {
    const at = Date.parse(event.at);
    return Number.isFinite(at) && at > end && at <= now
      && (event.type !== "Meeting" || event.outcome === "COMPLETED");
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const calls = events.filter(event => event.type === "Call");
  const connectedCalls = calls.filter(event => event.connected).length;
  const state = !input.linked ? "unlinked"
    : !Number.isFinite(end) ? "outcome-missing"
    : end > now ? "upcoming"
    : ["CANCELED", "RESCHEDULED"].includes(input.outcome) ? "excluded"
    : !["COMPLETED", "NO_SHOW"].includes(input.outcome) ? "outcome-missing"
    : input.closed ? "closed"
    : now - end < 24 * 3_600_000 ? "within-sla" : "reviewable";
  const eligible = state === "reviewable";
  return {
    eligible, state, events, callAttempts: calls.length, connectedCalls,
    noFollowUp: eligible && !events.length,
    noCallAttempts: eligible && !calls.length,
    noConnectedCall: eligible && !connectedCalls,
    noNextTask: eligible && !input.nextTask,
    overdueTask: eligible && input.overdueTask,
  };
}

export type ManagementRow = {
  id: string; meetingDate: string;
  salesRep: { id: string; name: string };
  company: { id: string; name: string } | null;
  contacts: Array<{ id: string }>;
  deal: { id?: string; stage: string } | null;
  review: HandoffReview;
};
export type ReviewBucket = "all" | "noFollowUp" | "noCallAttempts" | "noConnectedCall" | "noNextTask" | "overdueTask" | "outcome-missing";
export function accountReviewRows<T extends ManagementRow>(rows: T[]): T[] {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.salesRep.id}:${row.company?.id || row.contacts[0]?.id || row.deal?.id || row.id}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  return [...grouped.values()].map(group => {
    // A later scheduled/cancelled meeting must not hide the previous completed
    // SDR handoff. Show one actionable account per rep, retaining all meetings
    // for the account-history drawer.
    const past = group.filter(row => !["upcoming", "excluded"].includes(row.review.state));
    return [...(past.length ? past : group)].sort((a, b) => Date.parse(b.meetingDate) - Date.parse(a.meetingDate))[0];
  });
}
export function matchesReview(row: ManagementRow, bucket: ReviewBucket) {
  if (bucket === "all") return true;
  if (bucket === "outcome-missing") return row.review.state === bucket;
  return row.review[bucket];
}
