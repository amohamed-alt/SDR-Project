import { selectDashboardRecords } from "./dashboard-records.ts";
import type { ActivityRow, CompanyRow, ContactRow, DashboardData } from "./types.ts";

/** Aggregates only. Record evidence is queried separately against this version. */
export function projectDashboardSummary(data: DashboardData): DashboardData {
  const withoutIds = <T extends { ids: string[] }>(metric: T): T => ({ ...metric, ids: [] });
  const signals = data.intelligence;
  return {
    ...data,
    hubspotMeetingEvidence: [],
    priorityContacts: [], recentActivities: [], companies: [], deals: [],
    intelligence: {
      ...signals,
      staleDeals: withoutIds(signals.staleDeals),
      dealsWithoutFutureActivity: withoutIds(signals.dealsWithoutFutureActivity),
      dealsWithOverdueCloseDate: withoutIds(signals.dealsWithOverdueCloseDate),
      meetingsWithoutFollowUp: withoutIds(signals.meetingsWithoutFollowUp),
      completedMeetingsWithoutProgression: withoutIds(signals.completedMeetingsWithoutProgression),
      noShowMeetings: withoutIds(signals.noShowMeetings),
      highEngagementAccountsWithoutMeeting: withoutIds(signals.highEngagementAccountsWithoutMeeting),
      contactsWithConnectedCallsWithoutMeeting: withoutIds(signals.contactsWithConnectedCallsWithoutMeeting),
      accountEngagement: [],
      leadResponseSla: { ...signals.leadResponseSla, overdueIds: [] },
      missingContactInfo: {
        missingPhone: withoutIds(signals.missingContactInfo.missingPhone),
        missingEmail: withoutIds(signals.missingContactInfo.missingEmail),
        missingLinkedIn: withoutIds(signals.missingContactInfo.missingLinkedIn),
        missingAny: withoutIds(signals.missingContactInfo.missingAny),
      },
    },
  };
}

const PRIORITY_CONTACT_LIMIT = 60;
const NEWEST_ONLINE_CONTACT_LIMIT = 60;
const RECENT_ACTIVITY_LIMIT = 80;
const IMPORTANT_ACTIVITY_LIMIT = 120;
const COMPANY_LIMIT = 80;

function isOnlineContact(contact: ContactRow) {
  return contact.originalSource !== "Offline Sources" && contact.originalSource !== "Unknown";
}

function importantActivity(activity: ActivityRow) {
  if (activity.type === "Meeting" && activity.isOpen) return true;
  if (activity.type !== "Task" || !activity.isOpen) return false;
  return activity.dueBucket === "Due today" || activity.isHighPriority;
}

function activitySortValue(activity: ActivityRow) {
  const value = activity.dueAt || activity.occurredAt || activity.metricAt;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function companySignal(company: CompanyRow) {
  const associated = Number(company.associatedContacts || 0);
  const hasAts = company.ats && company.ats !== "Unknown" ? 1 : 0;
  return associated * 10 + hasAts;
}

/**
 * Browser payload projection only. The full HubSpot snapshot remains available
 * server-side for KPI/chart calculations and background refreshes.
 *
 * The default dashboard only needs enough record detail for the immediate SDR
 * execution view. Heavy historical rows are intentionally kept off the initial
 * response so opening the dashboard is dominated by rendering, not JSON transfer
 * and parsing.
 */
export function projectDashboardPayload(data: DashboardData): DashboardData {
  const contactIds = new Set(
    data.priorityContacts.slice(0, PRIORITY_CONTACT_LIMIT).map((contact) => contact.id),
  );

  const newestOnlineContacts = data.priorityContacts
    .filter(isOnlineContact)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, NEWEST_ONLINE_CONTACT_LIMIT);

  for (const contact of newestOnlineContacts) contactIds.add(contact.id);

  const key = (row: ActivityRow) => `${row.type}:${row.id}`;
  const sortedImportant = data.recentActivities.filter(importantActivity).sort((left, right) => activitySortValue(left) - activitySortValue(right));
  const todayTasks = sortedImportant.filter(row => row.type === "Task" && row.dueBucket === "Due today");
  const upcoming = (selectDashboardRecords(data, { kind: "activities", scope: "workspace-upcoming-meetings" }) as ActivityRow[]).sort((left, right) => activitySortValue(left) - activitySortValue(right));
  const meetingsToday = selectDashboardRecords(data, { kind: "activities", scope: "workspace-meetings-today" }) as ActivityRow[];
  // Reserve independent previews so old high-priority work cannot crowd out today.
  const importantPreview = [...todayTasks.slice(0, 40), ...meetingsToday.slice(0, 20), ...upcoming.slice(0, 20)];
  const importantKeys = new Set(importantPreview.map(key));
  for (const row of sortedImportant) {
    if (importantKeys.size >= IMPORTANT_ACTIVITY_LIMIT) break;
    importantKeys.add(key(row));
  }
  const activityIds = new Set([...importantKeys, ...data.recentActivities.slice(0, RECENT_ACTIVITY_LIMIT).map(key)]);
  const workspaceSummary = {
    onlineLeads: selectDashboardRecords(data, { kind: "contacts", scope: "workspace-online" }).length,
    untouchedOnlineLeads: selectDashboardRecords(data, { kind: "contacts", scope: "workspace-untouched-online" }).length,
    meetingsToday: meetingsToday.length,
    upcomingMeetings: upcoming.length,
  };

  const companies = [...data.companies]
    .sort((left, right) => {
      const signalDelta = companySignal(right) - companySignal(left);
      return signalDelta || left.name.localeCompare(right.name);
    })
    .slice(0, COMPANY_LIMIT);

  return {
    ...data,
    hubspotMeetingEvidence: [],
    priorityContacts: data.priorityContacts.filter((contact) => contactIds.has(contact.id)),
    workspaceSummary,
    recentActivities: data.recentActivities.filter((activity) => activityIds.has(key(activity))),
    companies,
  };
}
