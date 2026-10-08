import { acquisitionMotion } from "./meeting-performance.ts";
import type { ActivityRow, CompanyRow, ContactRow, DashboardData, DashboardFilters, DealRow } from "./types.ts";

import { callSegmentValue, type CallSegment } from "./call-segment-values.ts";

export type RecordKind = "contacts" | "activities" | "companies" | "deals";
export type DashboardRecord = ContactRow | ActivityRow | CompanyRow | DealRow;
export type RecordCondition = { field: string; op?: "eq" | "contains" | "missing" | "present" | "pretty"; value?: string | number | boolean };
export type RecordSelection = {
  kind: RecordKind;
  callSegment?: CallSegment;
  scope?: "source" | "created" | "activity-period" | "task-status";
  where?: RecordCondition[];
  signal?: string;
  alert?: string;
  day?: string;
  funnel?: string;
  emailEngagement?: string;
  outcome?: string;
};
export type DashboardRecordSource = { filters: DashboardFilters; version: string; selection: RecordSelection };
export type DashboardRecordPage = { rows: DashboardRecord[]; total: number; offset: number; limit: number; version: string };

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function dayInZone(value: string, timezone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  let formatter = dayFormatters.get(timezone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormatters.set(timezone, formatter); }
  return formatter.format(date);
}
function inPeriod(value: string, data: DashboardData) {
  const day = dayInZone(value, data.meta.timezone);
  return Boolean(day) && day >= data.meta.from && day <= data.meta.to;
}
function pretty(value: string) {
  return value && value !== "—" ? value.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()) : "Unknown";
}
function signalIds(data: DashboardData, signal: string): Set<string> {
  const intelligence = data.intelligence;
  const value = signal === "response-overdue" ? intelligence.leadResponseSla.overdueIds
    : signal === "missing-contact-info" ? intelligence.missingContactInfo.missingAny.ids
    : signal in intelligence ? (intelligence[signal as keyof typeof intelligence] as { ids?: string[] }).ids : undefined;
  if (!value) throw new Error("Unknown dashboard signal");
  return new Set(value);
}

export function selectDashboardRecords(data: DashboardData, selection: RecordSelection): DashboardRecord[] {
  const now = new Date(data.meta.generatedAt).getTime();
  let rows: DashboardRecord[] = selection.kind === "contacts" ? data.priorityContacts
    : selection.kind === "activities" ? data.recentActivities
      : selection.kind === "companies" ? data.companies : data.deals;
  if (selection.callSegment) {
    const contacts = new Map(data.priorityContacts.map(contact => [contact.id, contact]));
    const segment = selection.callSegment;
    rows = rows.filter(row => "type" in row && row.type === "Call" && callSegmentValue(row, contacts.get(row.relatedContactId || ""), segment.field, data.meta.timezone || "Asia/Riyadh") === segment.value);
  }
  if (selection.scope === "activity-period") rows = rows.filter(row => "metricAt" in row && inPeriod(row.metricAt, data));
  if (selection.scope === "task-status") rows = rows.filter(row => "metricAt" in row && (row.isOpen || inPeriod(row.metricAt, data)));
  if (selection.scope === "source" || selection.scope === "created") {
    const created = rows.filter(row => "createdAt" in row && inPeriod(row.createdAt, data));
    rows = selection.scope === "source" && !created.length ? rows : created;
  }
  if (selection.signal) {
    const ids = signalIds(data, selection.signal);
    rows = rows.filter(row => ids.has(row.id));
  }
  if (selection.funnel) {
    const field = { Contacted: "lastContacted", Connected: "hasConnectedCall", Meeting: "hasMeeting", Deal: "hasDeal", "Open Deal": "hasOpenDeal" }[selection.funnel];
    if (field) rows = rows.filter(row => Boolean((row as unknown as Record<string, unknown>)[field]));
  }
  if (selection.day) rows = rows.filter(row => "metricAt" in row && dayInZone(row.metricAt, data.meta.timezone) === selection.day);
  if (selection.emailEngagement) {
    const field = { Opened: "opened", Clicked: "clicked", Replied: "replied" }[selection.emailEngagement];
    if (field) rows = rows.filter(row => Boolean((row as unknown as Record<string, unknown>)[field]));
  }
  if (selection.outcome) rows = rows.filter(row => {
    if (!("status" in row)) return false;
    if (row.type === "Call" && row.detail) return row.detail === selection.outcome || (selection.outcome === "Unknown" && row.detail === "No disposition");
    return row.status === selection.outcome || row.detail === selection.outcome;
  });
  if (selection.alert) {
    const alert = selection.alert;
    rows = rows.filter(row => {
      if ("type" in row) {
        if (alert === "meeting-outcomes" || alert === "outcomes") return row.type === "Meeting" && ["Unknown", "Scheduled"].includes(row.status) && Date.parse(row.occurredAt) <= now && inPeriod(row.occurredAt, data);
        if (row.type !== "Task" || !row.isOpen) return false;
        if (alert === "due-today") return row.dueBucket === "Due today";
        if (alert === "due-tomorrow" || alert === "due") return row.dueBucket === "Due tomorrow";
        if (alert === "overdue") return Boolean(row.dueAt) && new Date(row.dueAt).getTime() < now;
        if (alert === "high-priority-tasks") return row.isHighPriority;
      }
      if ("lastContacted" in row) {
        if (alert === "untouched-24h") return !row.lastContacted && new Date(row.createdAt).getTime() < now - 86_400_000;
        if (alert === "no-next-activity") return !row.nextActivity;
        if (alert === "response-time-missing") return inPeriod(row.createdAt, data) && acquisitionMotion(row.contactSource, row.leadSource) === "Inbound" && row.leadResponseTimeHours === null;
        if (alert === "response-time-known") return inPeriod(row.createdAt, data) && acquisitionMotion(row.contactSource, row.leadSource) === "Inbound" && row.leadResponseTimeHours !== null;
        if (alert === "high-icp" || alert === "tier-a") return /^(a|tier a|tier[ _]1|high)$/i.test(row.tier) && !row.lastContacted;
        if (alert === "high-priority-untouched") return row.contactPriority === "High" && !row.lastContacted;
        if (alert === "wrong-phone" || alert === "phones") return /wrong/i.test(row.phoneStatus);
        if (alert === "missing-source") return row.qualityIssues.includes("hs_analytics_source");
      }
      return false;
    });
  }
  for (const condition of selection.where ?? []) {
    rows = rows.filter(row => {
      const value = (row as unknown as Record<string, unknown>)[condition.field];
      if (condition.op === "missing") return value == null || value === "";
      if (condition.op === "present") return value != null && value !== "";
      if (condition.op === "contains") return Array.isArray(value) ? value.includes(condition.value) : String(value ?? "").toLowerCase().includes(String(condition.value ?? "").toLowerCase());
      if (condition.op === "pretty") return pretty(String(value ?? "")) === condition.value;
      return value === condition.value;
    });
  }
  return rows;
}

export function queryDashboardRecords(data: DashboardData, selection: RecordSelection, options: { q?: string; sort?: string; direction?: "asc" | "desc"; offset?: number; limit?: number } = {}): DashboardRecordPage {
  let rows = selectDashboardRecords(data, selection);
  const term = (options.q ?? "").trim().toLocaleLowerCase();
  if (term) rows = rows.filter(row => Object.values(row).some(value => String(value ?? "").toLocaleLowerCase().includes(term)));
  if (options.sort) {
    const key = options.sort;
    const direction = options.direction === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const left = (a as unknown as Record<string, unknown>)[key];
      const right = (b as unknown as Record<string, unknown>)[key];
      const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), "en", { numeric: true });
      return comparison * direction || a.id.localeCompare(b.id);
    });
  }
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit, version: data.meta.generatedAt };
}

export function dashboardRecordsCsv(rows: DashboardRecord[]) {
  const fields = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(field => field !== "qualityIssues");
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [fields.map(cell).join(","), ...rows.map(row => fields.map(field => cell((row as unknown as Record<string, unknown>)[field])).join(","))].join("\r\n");
}
