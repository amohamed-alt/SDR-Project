import { buildCallIntelligence } from "./call-intelligence.ts";
import type { ContactRow, DashboardData } from "./types.ts";
import type { RecordSelection } from "./dashboard-records.ts";

export type SegmentInsight = {
  name: string;
  contacts: number;
  connected: number;
  meetings: number;
  meetingReach: number;
  rankScore: number;
  evidence: "Established sample" | "Early signal" | "Insufficient evidence";
  selection: RecordSelection;
};

const missing = (value: string) => !value || ["unknown", "—", "not set"].includes(value.toLowerCase());
export function wilsonLowerBound(successes: number, total: number): number {
  if (!total) return 0;
  const p = Math.min(total, Math.max(0, successes)) / total;
  const z2 = 1.96 ** 2;
  return (p + z2 / (2 * total) - 1.96 * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total);
}

function segments(contacts: ContactRow[], fields: Array<"country" | "persona" | "tier">): SegmentInsight[] {
  const groups = new Map<string, { values: string[]; rows: ContactRow[] }>();
  for (const contact of contacts) {
    const values = fields.map(field => contact[field]);
    const key = JSON.stringify(values);
    const group = groups.get(key) ?? { values, rows: [] };
    group.rows.push(contact);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ values, rows }) => {
    const meetings = rows.filter(row => row.hasMeeting).length;
    const known = values.every(value => !missing(value));
    return {
      name: values.map(value => missing(value) ? "Unknown" : value).join(" · "),
      contacts: rows.length,
      connected: rows.filter(row => row.hasConnectedCall).length,
      meetings,
      meetingReach: Math.round(meetings / rows.length * 1000) / 10,
      rankScore: known ? Math.round(wilsonLowerBound(meetings, rows.length) * 10000) / 100 : 0,
      evidence: known && rows.length >= 30 && meetings >= 5 ? "Established sample" as const : known && rows.length >= 10 && meetings >= 2 ? "Early signal" as const : "Insufficient evidence" as const,
      selection: { kind: "contacts", where: fields.map((field, index) => ({ field, value: values[index] })) } satisfies RecordSelection,
    };
  }).sort((a, b) => b.rankScore - a.rankScore || b.meetings - a.meetings || b.contacts - a.contacts).slice(0, 12);
}

/** Contact-level reach, never a ratio of unrelated calls and meetings. The full
 * snapshot is required; browser samples and company-name joins are not evidence. */
export function buildDecisionInsights(data: DashboardData) {
  const contacts = data.priorityContacts;
  const markets = segments(contacts, ["country"]);
  const personas = segments(contacts, ["persona"]);
  const icps = segments(contacts, ["persona", "tier"]);
  const quality = {
    total: contacts.length,
    countryKnown: contacts.filter(row => !missing(row.country)).length,
    personaKnown: contacts.filter(row => !missing(row.persona)).length,
    tierKnown: contacts.filter(row => !missing(row.tier)).length,
  };
  const bestMarket = markets.find(row => row.evidence !== "Insufficient evidence");
  const bestIcp = icps.find(row => row.evidence !== "Insufficient evidence");
  const actions: Array<{ id: string; title: string; reason: string; count: number; selection: RecordSelection }> = [
    { id: "follow-up", title: "Recover meeting follow-up", reason: "Completed / no-show meetings past 24h with no later logged activity.", count: data.intelligence.meetingsWithoutFollowUp.count, selection: { kind: "activities", signal: "meetingsWithoutFollowUp" } },
    { id: "connected", title: "Progress connected contacts", reason: "Contacts with a connected call but no meeting in this reporting snapshot.", count: data.intelligence.contactsWithConnectedCallsWithoutMeeting.count, selection: { kind: "contacts", signal: "contactsWithConnectedCallsWithoutMeeting" } },
    { id: "stale", title: "Review stalled opportunities", reason: "Open deals with no known contact activity for at least 21 days.", count: data.intelligence.staleDeals.count, selection: { kind: "deals", signal: "staleDeals" } },
  ];
  return {
    calling: buildCallIntelligence(data),
    markets, personas, icps, quality, actions: actions.filter(action => action.count > 0),
    bestMarket: bestMarket ?? null, bestIcp: bestIcp ?? null,
    definition: "Current owner contact portfolio, including active contact filters. Connected / meeting counts are distinct contacts with associated activity in the selected period; they are not closed-won conversion or proof of causation.",
    ranking: "Ranked by the 95% Wilson lower bound of meeting reach, which discounts tiny samples. Established sample: at least 30 contacts and 5 with meetings; early signal: at least 10 and 2. Unknown fields cannot be a recommended segment.",
  };
}
export type DecisionInsights = ReturnType<typeof buildDecisionInsights>;

function aggregateSegment(row: SegmentInsight) {
  return { name: row.name, contacts: row.contacts, connected: row.connected, meetings: row.meetings, meetingReach: row.meetingReach, rankScore: row.rankScore, evidence: row.evidence };
}

export function agentEvidence(data: DashboardData, insights: DecisionInsights) {
  // Deliberately aggregate-only: no names, emails, phone numbers or deal details.
  return {
    period: { from: data.meta.from, to: data.meta.to },
    warnings: data.meta.warnings.length,
    definition: insights.definition, ranking: insights.ranking,
    calls: data.kpis.calls, connectedCalls: data.kpis.connectedCalls,
    meetings: data.kpis.bookedMeetings, completedMeetings: data.kpis.completedMeetings,
    responseTimingCoverage: data.kpis.leadResponseCoverage,
    quality: insights.quality,
    markets: insights.markets.slice(0, 5).map(aggregateSegment),
    icps: insights.icps.slice(0, 5).map(aggregateSegment),
    priorities: insights.actions.map(action => ({ id: action.id, title: action.title, count: action.count, reason: action.reason })),
  };
}
