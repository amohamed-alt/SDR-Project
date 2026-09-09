import type { ActivityRow, ContactRow, DashboardData } from "./types.ts";

const PRIORITY_CONTACT_LIMIT = 150;
const NEWEST_ONLINE_CONTACT_LIMIT = 150;
const RECENT_ACTIVITY_LIMIT = 200;

function isOnlineContact(contact: ContactRow) {
  return contact.originalSource !== "Offline Sources" && contact.originalSource !== "Unknown";
}

function importantActivity(activity: ActivityRow) {
  if (activity.type === "Meeting" && activity.isOpen) return true;
  if (activity.type !== "Task" || !activity.isOpen) return false;
  return activity.dueBucket === "Due today" || activity.isHighPriority;
}

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
  for (const activity of data.recentActivities) {
    if (importantActivity(activity)) activityIds.add(activity.id);
  }

  return {
    ...data,
    priorityContacts: data.priorityContacts.filter((contact) => contactIds.has(contact.id)),
    recentActivities: data.recentActivities.filter((activity) => activityIds.has(activity.id)),
  };
}
