import type { ActivityRow, ContactRow } from "./types.ts";
export type CallDimension = "title" | "company" | "country" | "contact" | "hour";
export type CallSegment = { field: CallDimension; value: string };
export const knownCallValue = (value?: string) => value && !/^(unknown|—|not set)$/i.test(value.trim()) ? value.trim() : "Unknown";
const hourFormatters = new Map<string, Intl.DateTimeFormat>();
export function callSegmentValue(call: ActivityRow, contact: ContactRow | undefined, field: CallDimension, timezone: string) {
  if (field === "contact") return call.relatedContactId || "Unknown";
  if (field === "hour") {
    if (!Number.isFinite(Date.parse(call.metricAt))) return "Unknown";
    let formatter = hourFormatters.get(timezone);
    if (!formatter) { formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }); hourFormatters.set(timezone, formatter); }
    return formatter.format(new Date(call.metricAt));
  }
  return knownCallValue(contact?.[field]);
}
