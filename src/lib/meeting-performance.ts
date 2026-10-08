export type AcquisitionMotion = "Inbound" | "Outbound" | "Unknown";
export function acquisitionMotion(contactSource: string, leadSource = ""): AcquisitionMotion {
  const explicit = `${contactSource} ${leadSource}`.trim().toLowerCase();
  const inbound = /\binbound\b|inbound marketing/.test(explicit);
  const outbound = /\boutbound\b|sales generated|prospecting/.test(explicit);
  return inbound === outbound ? "Unknown" : inbound ? "Inbound" : "Outbound";
}
export function verifiedEmailStatus(raw: string) {
  return ["valid", "verified", "deliverable"].includes(raw.trim().toLowerCase());
}
export function testedPhoneStatus(raw: string) {
  return ["correct", "valid", "verified", "updated"].includes(raw.trim().toLowerCase());
}
export type MeetingFact = { createdAt: string; startAt: string; outcome: string; motion: AcquisitionMotion };
export function meetingPerformance(meetings: MeetingFact[], from: string, to: string, now: Date, timezone = "Asia/Riyadh") {
  const day = (raw: string) => Number.isFinite(Date.parse(raw)) ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(raw)) : "";
  const inPeriod = (raw: string) => { const d = day(raw); return !!d && d >= from && d <= to; };
  const isBackfill = (m: MeetingFact) => Number.isFinite(Date.parse(m.startAt)) && Date.parse(m.createdAt) > Date.parse(m.startAt);
  const booked = meetings.filter(m => inPeriod(m.createdAt) && Date.parse(m.createdAt) <= now.getTime() && !isBackfill(m));
  const elapsed = meetings.filter(m => inPeriod(m.startAt) && Date.parse(m.startAt) <= now.getTime() && !["CANCELED", "RESCHEDULED"].includes(m.outcome));
  const held = elapsed.filter(m => m.outcome === "COMPLETED");
  return { booked: booked.length, inbound: booked.filter(m=>m.motion === "Inbound").length, outbound: booked.filter(m=>m.motion === "Outbound").length, unknown: booked.filter(m=>m.motion === "Unknown").length, backfilled: meetings.filter(m=>inPeriod(m.createdAt) && isBackfill(m)).length, held: held.length, elapsed: elapsed.length, upcoming: meetings.filter(m=>inPeriod(m.createdAt) && Date.parse(m.startAt)>now.getTime() && !["CANCELED", "RESCHEDULED"].includes(m.outcome)).length, missingOutcomes: elapsed.filter(m=>["SCHEDULED","UNKNOWN", ""].includes(m.outcome)).length, attendanceRate: elapsed.length ? Math.round(held.length/elapsed.length*1000)/10 : 0 };
}
export type MeetingPerformance = ReturnType<typeof meetingPerformance>;
export function monthlyPacing(month: string, asOf: string) {
  const start = new Date(`${month}-01T12:00:00Z`);
  let total = 0, elapsed = 0;
  for (const date = new Date(start); date.getUTCMonth() === start.getUTCMonth(); date.setUTCDate(date.getUTCDate()+1)) {
    if (date.getUTCDay() === 5 || date.getUTCDay() === 6) continue;
    total++;
    if (date.toISOString().slice(0,10) <= asOf) elapsed++;
  }
  return { total, elapsed, fraction: total ? elapsed / total : 0 };
}
