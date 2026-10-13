import type { ActivityRow, ContactRow, DashboardData, ChartDatum } from "./types.ts";

export type Motion = "Inbound" | "Outbound" | "Unknown";
export type MotionMetrics = {
  contacts: number;
  calls: number;
  connected: number;
  connectionRate: number;
  meetings: number;
  completedTasks: number;
  emails: number;
  whatsApp: number;
  dealContacts: number;
  openDealContacts: number;
};
export type MotionDailyDatum = {
  date: string;
  inboundCalls: number;
  outboundCalls: number;
  inboundConnected: number;
  outboundConnected: number;
  inboundActivities: number;
  outboundActivities: number;
};

export function contactMotion(row: ContactRow): Motion {
  const contactSource = row.contactSource.trim().toLowerCase();
  const leadSource = row.leadSource.trim().toLowerCase();
  const explicit = `${contactSource} ${leadSource}`;

  if (/inbound|marketing/.test(explicit)) return "Inbound";
  if (/outbound|sales generated|prospecting|sdr/.test(explicit)) return "Outbound";

  const originalSource = row.originalSource.trim().toLowerCase();
  if (!originalSource || originalSource === "unknown") return "Unknown";
  if (originalSource === "offline sources") return "Outbound";
  return "Inbound";
}

function eachDay(from: string, to: string) {
  const days: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end && days.length < 370) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}


const formatters = new Map<string, Intl.DateTimeFormat>();
export function motionDay(value: string, timezone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  let formatter = formatters.get(timezone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); formatters.set(timezone, formatter); }
  return formatter.format(date);
}

/** Current work queues are not period execution. Keep the summary and evidence identical. */
export function isMotionActivity(row: ActivityRow, data: DashboardData) {
  if (row.type === "Task" && row.isOpen) return false;
  if (row.type === "Meeting" && row.bookedInPeriod === false) return false;
  const day = motionDay(row.metricAt, data.meta.timezone);
  return Boolean(day) && day >= data.meta.from && day <= data.meta.to;
}

export function motionActivityClassifier(data: DashboardData) {
  const contacts = new Map(data.priorityContacts.map(row => [row.id, contactMotion(row)]));
  const sheetMotions = new Map(data.meetingSheet?.status === "ready" ? data.meetingSheet.rows.map(row => [row.id, row.motion]) : []);
  return (row: ActivityRow): Motion => {
    if (row.type === "Meeting" && sheetMotions.has(row.id)) return sheetMotions.get(row.id)!;
    return contacts.get(row.relatedContactId || "") ?? "Unknown";
  };
}

/** Compute only aggregates over the complete cached snapshot, never browser previews. */
export function buildDashboardMotion(data: DashboardData) {
  const activityMotion = motionActivityClassifier(data);
  const contactsByMotion: Record<Motion, ContactRow[]> = { Inbound: [], Outbound: [], Unknown: [] };
  const activitiesByMotion: Record<Motion, ActivityRow[]> = { Inbound: [], Outbound: [], Unknown: [] };
  for (const row of data.priorityContacts) contactsByMotion[contactMotion(row)].push(row);
  for (const row of data.recentActivities) if (isMotionActivity(row, data)) activitiesByMotion[activityMotion(row)].push(row);
  const metricsFor = (motion: Motion): MotionMetrics => {
    const contacts = contactsByMotion[motion], activities = activitiesByMotion[motion];
    const calls = activities.filter(row => row.type === "Call");
    const connected = calls.filter(row => row.status === "Connected");
    return { contacts: contacts.length, calls: calls.length, connected: connected.length,
      connectionRate: calls.length ? Math.round(connected.length / calls.length * 1000) / 10 : 0,
      meetings: activities.filter(row => row.type === "Meeting").length,
      completedTasks: activities.filter(row => row.type === "Task").length,
      emails: activities.filter(row => row.type === "Email").length,
      whatsApp: activities.filter(row => row.type === "WhatsApp").length,
      dealContacts: contacts.filter(row => row.hasDeal).length,
      openDealContacts: contacts.filter(row => row.hasOpenDeal).length };
  };
  const funnelFor = (motion: Motion): ChartDatum[] => {
    const rows = contactsByMotion[motion];
    return [{ name: "Portfolio", value: rows.length },
      { name: "Contacted", value: rows.filter(row => Boolean(row.lastContacted)).length },
      { name: "Connected", value: rows.filter(row => row.hasConnectedCall).length },
      { name: "Meeting", value: rows.filter(row => row.hasMeeting).length },
      { name: "Deal", value: rows.filter(row => row.hasDeal).length },
      { name: "Open Deal", value: rows.filter(row => row.hasOpenDeal).length }];
  };
  const daily = new Map<string, MotionDailyDatum>(eachDay(data.meta.from, data.meta.to).map(date => [date, { date, inboundCalls: 0, outboundCalls: 0, inboundConnected: 0, outboundConnected: 0, inboundActivities: 0, outboundActivities: 0 }]));
  for (const motion of ["Inbound", "Outbound"] as const) for (const row of activitiesByMotion[motion]) {
    const point = daily.get(motionDay(row.metricAt, data.meta.timezone));
    if (!point) continue;
    if (motion === "Inbound") { point.inboundActivities++; if (row.type === "Call") { point.inboundCalls++; if (row.status === "Connected") point.inboundConnected++; } }
    else { point.outboundActivities++; if (row.type === "Call") { point.outboundCalls++; if (row.status === "Connected") point.outboundConnected++; } }
  }
  const classified = contactsByMotion.Inbound.length + contactsByMotion.Outbound.length;
  return { inboundMetrics: metricsFor("Inbound"), outboundMetrics: metricsFor("Outbound"), unknownMetrics: metricsFor("Unknown"),
    inboundFunnel: funnelFor("Inbound"), outboundFunnel: funnelFor("Outbound"), daily: [...daily.values()],
    unknownActivities: activitiesByMotion.Unknown.length,
    classificationCoverage: data.priorityContacts.length ? Math.round(classified / data.priorityContacts.length * 1000) / 10 : null };
}
export type MotionDashboardData = { meta: DashboardData["meta"]; motion: ReturnType<typeof buildDashboardMotion> };
