import type { ActivityRow, DashboardData } from "./types.ts";
import { dayInZone, type RecordSelection } from "./dashboard-records.ts";

import { callSegmentValue, knownCallValue as known, type CallDimension } from "./call-segment-values.ts";
export function periodCalls(data: DashboardData) {
  return (data.recentActivities ?? []).filter(call => {
    if (call.type !== "Call") return false;
    const day = dayInZone(call.metricAt, data.meta.timezone || "Asia/Riyadh");
    return day >= data.meta.from && day <= data.meta.to;
  });
}
export function buildCallIntelligence(data: DashboardData) {
  const contacts = new Map(data.priorityContacts.map(row => [row.id, row]));
  const calls = periodCalls(data);
  const timezone = data.meta.timezone || "Asia/Riyadh";
  function group(field: CallDimension) {
    const buckets = new Map<string, { calls: ActivityRow[]; people: Set<string> }>();
    for (const call of calls) {
      const key = callSegmentValue(call, contacts.get(call.relatedContactId || ""), field, timezone);
      const bucket = buckets.get(key) ?? { calls: [], people: new Set<string>() };
      bucket.calls.push(call);
      if (call.relatedContactId) bucket.people.add(call.relatedContactId);
      buckets.set(key, bucket);
    }
    return [...buckets].map(([value, bucket]) => {
      const contact = field === "contact" ? contacts.get(value) : undefined;
      const connected = bucket.calls.filter(call => call.detail === "Connected").length;
      const meetingContacts = [...bucket.people].filter(id => contacts.get(id)?.hasMeeting).length;
      return { value, name: field === "contact" ? contact?.name || bucket.calls[0].relatedContactName || "Unlinked calls" : field === "hour" ? `${value}:00` : value,
        title: contact ? known(contact.title) : "", company: contact ? known(contact.company) : "",
        calls: bucket.calls.length, connected, people: bucket.people.size, meetingContacts,
        rate: Math.round(connected / bucket.calls.length * 1000) / 10,
        selection: { kind: "activities", scope: "activity-period", callSegment: { field, value } } satisfies RecordSelection };
    }).sort((a, b) => field === "hour" ? a.value.localeCompare(b.value) : b.calls - a.calls || b.connected - a.connected || a.name.localeCompare(b.name));
  }
  const people = group("contact");
  return { calls: calls.length, connected: calls.filter(call => call.detail === "Connected").length,
    people: new Set(calls.map(call => call.relatedContactId).filter(Boolean)).size,
    matchedCalls: calls.filter(call => contacts.has(call.relatedContactId || "")).length,
    titleKnownCalls: calls.filter(call => known(contacts.get(call.relatedContactId || "")?.title) !== "Unknown").length,
    repeatedPeople: people.filter(row => row.value !== "Unknown" && row.calls > 1).length,
    lastCallAt: calls.reduce((latest, call) => call.metricAt > latest ? call.metricAt : latest, ""),
    titles: group("title").slice(0, 15), companies: group("company").slice(0, 15), markets: group("country"),
    contacts: people.slice(0, 20), hours: group("hour"),
    definition: "Calls use the logged call timestamp in the reporting timezone. Each call is assigned once to its selected linked contact. Titles and company labels are current CRM fields; missing or out-of-portfolio profiles stay Unknown. With meeting means called people also associated with a booked meeting in this period, not a conversion caused by the call." };
}
export type CallIntelligence = ReturnType<typeof buildCallIntelligence>;
export type CallGroup = CallIntelligence["titles"][number];
