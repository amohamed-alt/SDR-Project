import type { ActivityRow, CompanyRow, ContactRow, DashboardData } from "./types.ts";

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

  const activityIds = new Set(
    data.recentActivities.slice(0, RECENT_ACTIVITY_LIMIT).map((activity) => activity.id),
  );
  const importantActivities = data.recentActivities
    .filter(importantActivity)
    .sort((left, right) => activitySortValue(left) - activitySortValue(right))
    .slice(0, IMPORTANT_ACTIVITY_LIMIT);
  for (const activity of importantActivities) activityIds.add(activity.id);

  const companies = [...data.companies]
    .sort((left, right) => {
      const signalDelta = companySignal(right) - companySignal(left);
      return signalDelta || left.name.localeCompare(right.name);
    })
    .slice(0, COMPANY_LIMIT);

  return {
    ...data,
    priorityContacts: data.priorityContacts.filter((contact) => contactIds.has(contact.id)),
    recentActivities: data.recentActivities.filter((activity) => activityIds.has(activity.id)),
    companies,
  };
}
