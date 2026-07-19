import {
  BOOKING_MEETING_SOURCES,
  CALL_DISPOSITION_LABELS,
  CALL_PROPERTIES,
  COMPANY_PROPERTIES,
  CONNECTED_CALL_DISPOSITION,
  CONTACT_PROPERTIES,
  DEAL_PROPERTIES,
  EMAIL_PROPERTIES,
  HUBSPOT_PORTAL_ID,
  HUBSPOT_TIMEZONE,
  MEETING_PROPERTIES,
  TASK_PROPERTIES,
  hubspotListUrl,
  hubspotRecordUrl,
} from "@/lib/config";
import {
  batchRead,
  getPropertyDefinitions,
  listDealStages,
  listOwners,
  readAssociations,
  searchAll,
  type HubSpotPropertyDefinition,
  type SearchFilter,
} from "@/lib/hubspot";
import type {
  ActivityRow,
  AlertItem,
  ChartDatum,
  CompanyRow,
  ContactRow,
  DailyActivityDatum,
  DashboardData,
  DashboardFilters,
  DealRow,
  HubSpotOwner,
  HubSpotRecord,
  LabelOption,
  QualityMetric,
} from "@/lib/types";

const OPEN_TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "DEFERRED"];
const OUTCOME_PRIORITY = ["COMPLETED", "NO_SHOW", "CANCELED", "RESCHEDULED", "SCHEDULED"];

function value(record: HubSpotRecord, key: string) {
  return record.properties[key]?.trim() ?? "";
}

function pretty(raw: string) {
  if (!raw) return "Unknown";
  return raw
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function number(raw: string) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isBetween(raw: string, from: string, to: string) {
  if (!raw) return false;
  const timestamp = new Date(raw).getTime();
  return timestamp >= new Date(`${from}T00:00:00+03:00`).getTime() && timestamp <= new Date(`${to}T23:59:59.999+03:00`).getTime();
}

function localParts(raw: string) {
  if (!raw) return { day: "", hour: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HUBSPOT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(raw));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { day: `${part("year")}-${part("month")}-${part("day")}`, hour: part("hour") };
}

function localDay(raw: string) {
  return localParts(raw).day;
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

function countBy(records: HubSpotRecord[], getter: (record: HubSpotRecord) => string, labels: Record<string, string> = {}): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const raw = getter(record) || "Unknown";
    const label = labels[raw] ?? pretty(raw);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, value: count })).sort((a, b) => b.value - a.value);
}

function propertyOptions(definitions: HubSpotPropertyDefinition[], propertyName: string) {
  return Object.fromEntries(
    (definitions.find((definition) => definition.name === propertyName)?.options ?? [])
      .filter((option) => !option.hidden)
      .map((option) => [option.value, option.label]),
  );
}

function displayValue(raw: string, labels: Record<string, string>) {
  return labels[raw] ?? pretty(raw);
}

function uniqueOptions(records: HubSpotRecord[], key: string, labels: Record<string, string> = {}): LabelOption[] {
  return [...new Set(records.map((record) => value(record, key)).filter(Boolean))]
    .map((item) => ({ value: item, label: labels[item] ?? pretty(item) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function completeness(key: string, label: string, records: HubSpotRecord[], predicate?: (record: HubSpotRecord) => boolean): QualityMetric {
  const complete = records.filter((record) => (predicate ? predicate(record) : Boolean(value(record, key)))).length;
  return { key, label, complete, total: records.length, rate: records.length ? Math.round((complete / records.length) * 1000) / 10 : 0 };
}

function filterAssociated(records: HubSpotRecord[], map: Map<string, string[]>, selectedIds: Set<string>, enabled: boolean) {
  if (!enabled) return records;
  return records.filter((record) => (map.get(record.id) ?? []).some((contactId) => selectedIds.has(contactId)));
}

function dedupeMeetings(meetings: HubSpotRecord[], associations: Map<string, string[]>) {
  const groups = new Map<string, HubSpotRecord[]>();
  for (const meeting of meetings) {
    const timestamp = value(meeting, "hs_meeting_start_time") || value(meeting, "hs_timestamp") || value(meeting, "hs_createdate");
    const { day, hour } = localParts(timestamp);
    const contactKey = (associations.get(meeting.id) ?? []).sort().join(",");
    const title = value(meeting, "hs_meeting_title").toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    const key = contactKey ? `${contactKey}|${day}|${hour}` : `${title || meeting.id}|${day}|${hour}`;
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }

  return [...groups.values()].map((records) => {
    const booking = records.find((record) => BOOKING_MEETING_SOURCES.has(value(record, "hs_meeting_source"))) ?? records[0];
    const outcome = OUTCOME_PRIORITY.find((candidate) => records.some((record) => value(record, "hs_meeting_outcome") === candidate)) ?? "UNKNOWN";
    return {
      records,
      booking,
      outcome,
      ownerId: value(booking, "hubspot_owner_id"),
      source: value(booking, "hs_meeting_source") || "CRM_UI",
      createdAt: value(booking, "hs_createdate") || value(booking, "hs_timestamp"),
      startAt: value(booking, "hs_meeting_start_time") || value(booking, "hs_timestamp"),
      contactIds: associations.get(booking.id) ?? [],
    };
  });
}

async function optional<T>(label: string, warnings: string[], action: () => Promise<T>, fallback: T) {
  try {
    return await action();
  } catch (error) {
    warnings.push(`${label}: ${error instanceof Error ? error.message : "unavailable"}`);
    return fallback;
  }
}

function activityFilters(ownerId: string, dateProperty: string, from: string, to: string, ownerProperty = "hubspot_owner_id"): SearchFilter[] {
  return [
    { propertyName: ownerProperty, operator: "EQ", value: ownerId },
    { propertyName: dateProperty, operator: "GTE", value: `${from}T00:00:00+03:00` },
    { propertyName: dateProperty, operator: "LTE", value: `${to}T23:59:59.999+03:00` },
  ];
}

export async function buildDashboard(filters: DashboardFilters): Promise<DashboardData> {
  const warnings: string[] = [];
  const cohortFilterEnabled = Boolean(filters.country || filters.originalSource || filters.latestSource || filters.tier || filters.persona);

  const [
    allContacts,
    callsRaw,
    meetingsRaw,
    tasksDueRaw,
    tasksCompletedRaw,
    emailsRaw,
    owners,
    stageLabels,
    contactDefinitions,
    meetingDefinitions,
    taskDefinitions,
    ...openTaskGroups
  ] = await Promise.all([
    searchAll("contacts", CONTACT_PROPERTIES, [{ propertyName: "sdr_owner", operator: "EQ", value: filters.ownerId }], ["createdate"]),
    optional("Calls", warnings, () => searchAll("calls", CALL_PROPERTIES, activityFilters(filters.ownerId, "hs_timestamp", filters.from, filters.to), ["hs_timestamp"]), []),
    optional("Meetings", warnings, () => searchAll("meetings", MEETING_PROPERTIES, activityFilters(filters.ownerId, "hs_createdate", filters.from, filters.to, "hs_created_by_user_id"), ["hs_createdate"]), []),
    optional("Tasks due", warnings, () => searchAll("tasks", TASK_PROPERTIES, activityFilters(filters.ownerId, "hs_timestamp", filters.from, filters.to), ["hs_timestamp"]), []),
    optional("Tasks completed", warnings, () => searchAll("tasks", TASK_PROPERTIES, activityFilters(filters.ownerId, "hs_task_completion_date", filters.from, filters.to), ["hs_task_completion_date"]), []),
    optional("Emails", warnings, () => searchAll("emails", EMAIL_PROPERTIES, activityFilters(filters.ownerId, "hs_timestamp", filters.from, filters.to), ["hs_timestamp"]), []),
    optional("Owners", warnings, () => listOwners(), [] as HubSpotOwner[]),
    optional("Deal stages", warnings, () => listDealStages(), new Map<string, string>()),
    optional("Contact property labels", warnings, () => getPropertyDefinitions("contacts", [
      "hs_analytics_source", "hs_latest_source", "hs_object_source_label", "hs_lead_status",
      "lifecyclestage", "contact_source", "gtm_icp_tier", "gtm_persona",
    ]), [] as HubSpotPropertyDefinition[]),
    optional("Meeting property labels", warnings, () => getPropertyDefinitions("meetings", [
      "hs_meeting_outcome", "hs_meeting_source",
    ]), [] as HubSpotPropertyDefinition[]),
    optional("Task property labels", warnings, () => getPropertyDefinitions("tasks", ["hs_task_status"]), [] as HubSpotPropertyDefinition[]),
    ...OPEN_TASK_STATUSES.map((status) =>
      optional(`Open tasks (${status})`, warnings, () => searchAll("tasks", TASK_PROPERTIES, [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: filters.ownerId },
        { propertyName: "hs_task_status", operator: "EQ", value: status },
      ]), []),
    ),
  ]);

  const originalSourceLabels = propertyOptions(contactDefinitions, "hs_analytics_source");
  const latestSourceLabels = propertyOptions(contactDefinitions, "hs_latest_source");
  const recordSourceLabels = propertyOptions(contactDefinitions, "hs_object_source_label");
  const leadStatusLabels = propertyOptions(contactDefinitions, "hs_lead_status");
  const lifecycleStageLabels = propertyOptions(contactDefinitions, "lifecyclestage");
  const contactSourceLabels = propertyOptions(contactDefinitions, "contact_source");
  const tierLabels = propertyOptions(contactDefinitions, "gtm_icp_tier");
  const personaLabels = propertyOptions(contactDefinitions, "gtm_persona");
  const meetingOutcomeLabels = propertyOptions(meetingDefinitions, "hs_meeting_outcome");
  const meetingSourceLabels = propertyOptions(meetingDefinitions, "hs_meeting_source");
  const taskStatusLabels = propertyOptions(taskDefinitions, "hs_task_status");

  const selectedContacts = allContacts.filter((contact) => {
    if (filters.country && value(contact, "country") !== filters.country) return false;
    if (filters.originalSource && value(contact, "hs_analytics_source") !== filters.originalSource) return false;
    if (filters.latestSource && value(contact, "hs_latest_source") !== filters.latestSource) return false;
    if (filters.tier && value(contact, "gtm_icp_tier") !== filters.tier) return false;
    if (filters.persona && value(contact, "gtm_persona") !== filters.persona) return false;
    return true;
  });
  const selectedIds = new Set(selectedContacts.map((contact) => contact.id));

  const [callContacts, meetingContacts, taskContacts, emailContacts, contactDeals] = await Promise.all([
    optional("Call associations", warnings, () => readAssociations("calls", "contacts", callsRaw.map((record) => record.id)), new Map<string, string[]>()),
    optional("Meeting associations", warnings, () => readAssociations("meetings", "contacts", meetingsRaw.map((record) => record.id)), new Map<string, string[]>()),
    optional("Task associations", warnings, () => readAssociations("tasks", "contacts", [...tasksDueRaw, ...tasksCompletedRaw, ...openTaskGroups.flat()].map((record) => record.id)), new Map<string, string[]>()),
    optional("Email associations", warnings, () => readAssociations("emails", "contacts", emailsRaw.map((record) => record.id)), new Map<string, string[]>()),
    optional("Deal associations", warnings, () => readAssociations("contacts", "deals", selectedContacts.map((record) => record.id)), new Map<string, string[]>()),
  ]);

  const calls = filterAssociated(callsRaw, callContacts, selectedIds, cohortFilterEnabled);
  const meetings = filterAssociated(meetingsRaw, meetingContacts, selectedIds, cohortFilterEnabled);
  const tasksDue = filterAssociated(tasksDueRaw, taskContacts, selectedIds, cohortFilterEnabled);
  const tasksCompleted = filterAssociated(tasksCompletedRaw, taskContacts, selectedIds, cohortFilterEnabled).filter((task) => value(task, "hs_task_status") === "COMPLETED");
  const openTasks = filterAssociated(openTaskGroups.flat(), taskContacts, selectedIds, cohortFilterEnabled);
  const emails = filterAssociated(emailsRaw, emailContacts, selectedIds, cohortFilterEnabled);

  const companyContactCounts = new Map<string, number>();
  for (const contact of selectedContacts) {
    const companyId = value(contact, "company_id");
    if (companyId) companyContactCounts.set(companyId, (companyContactCounts.get(companyId) ?? 0) + 1);
  }
  const companyIds = [...companyContactCounts.keys()];
  const dealIds = [...new Set([...contactDeals.values()].flat())];
  const [companiesRaw, dealsRaw] = await Promise.all([
    optional("Companies", warnings, () => batchRead("companies", companyIds, COMPANY_PROPERTIES), []),
    optional("Deals", warnings, () => batchRead("deals", dealIds, DEAL_PROPERTIES), []),
  ]);

  const ownerMap = new Map(owners.map((owner) => [owner.id, owner.name]));
  const ownerName = ownerMap.get(filters.ownerId) ?? (filters.ownerId === "31644369" ? "Marita Chedid" : filters.ownerId);
  const meetingGroups = dedupeMeetings(meetings, meetingContacts);
  const connectedCalls = calls.filter((call) => value(call, "hs_call_disposition") === CONNECTED_CALL_DISPOSITION);
  const outgoingEmails = emails.filter((email) => value(email, "hs_email_direction").includes("OUTGOING") || value(email, "hs_email_direction") === "EMAIL");
  const emailReplies = outgoingEmails.filter((email) => number(value(email, "hs_email_reply_count")) > 0).length;
  const newContacts = selectedContacts.filter((contact) => isBetween(value(contact, "createdate"), filters.from, filters.to));
  const sourceContacts = newContacts.length ? newContacts : selectedContacts;
  const integrationContacts = sourceContacts.filter((contact) => value(contact, "hs_object_source_label") === "INTEGRATION");
  const extensiveLighterContacts = integrationContacts.filter((contact) =>
    value(contact, "hs_object_source_detail_1").toLowerCase() === "extensive-lighter",
  );
  const formContacts = sourceContacts.filter((contact) => value(contact, "hs_object_source_label") === "FORM");
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const tomorrowDay = localDay(tomorrow.toISOString());
  const overdueTasks = openTasks.filter((task) => value(task, "hs_timestamp") && new Date(value(task, "hs_timestamp")) < now).length;
  const dueTomorrow = openTasks.filter((task) => localDay(value(task, "hs_timestamp")) === tomorrowDay).length;
  const completedMeetings = meetingGroups.filter((meeting) => meeting.outcome === "COMPLETED").length;
  const openDeals = dealsRaw.filter((deal) => value(deal, "hs_is_closed") !== "true");
  const dealsCreated = dealsRaw.filter((deal) => isBetween(value(deal, "createdate"), filters.from, filters.to));
  const untouchedContacts = selectedContacts.filter((contact) => !value(contact, "notes_last_contacted")).length;
  const nextActivityCount = selectedContacts.filter((contact) => Boolean(value(contact, "notes_next_activity_date"))).length;

  const dailyMap = new Map<string, DailyActivityDatum>(eachDay(filters.from, filters.to).map((date) => [date, {
    date, calls: 0, connected: 0, tasksCompleted: 0, tasksDue: 0, meetingsBooked: 0, emailsSent: 0,
  }]));
  for (const call of calls) {
    const day = localDay(value(call, "hs_timestamp"));
    const datum = dailyMap.get(day);
    if (datum) { datum.calls += 1; if (value(call, "hs_call_disposition") === CONNECTED_CALL_DISPOSITION) datum.connected += 1; }
  }
  for (const task of tasksDue) { const datum = dailyMap.get(localDay(value(task, "hs_timestamp"))); if (datum) datum.tasksDue += 1; }
  for (const task of tasksCompleted) { const datum = dailyMap.get(localDay(value(task, "hs_task_completion_date"))); if (datum) datum.tasksCompleted += 1; }
  for (const meeting of meetingGroups) { const datum = dailyMap.get(localDay(meeting.createdAt)); if (datum) datum.meetingsBooked += 1; }
  for (const email of outgoingEmails) { const datum = dailyMap.get(localDay(value(email, "hs_timestamp"))); if (datum) datum.emailsSent += 1; }

  const quality: QualityMetric[] = [
    completeness("email", "Email coverage", selectedContacts),
    completeness("gtm_email_status", "Verified email", selectedContacts, (contact) => /valid|verified|deliverable/i.test(value(contact, "gtm_email_status"))),
    completeness("phone", "Phone coverage", selectedContacts, (contact) => Boolean(value(contact, "phone") || value(contact, "mobilephone"))),
    completeness("phone_number_status", "Tested phone", selectedContacts, (contact) => /correct|valid|verified/i.test(value(contact, "phone_number_status"))),
    completeness("gtm_linkedin_url", "LinkedIn coverage", selectedContacts),
    completeness("company_id", "Company association", selectedContacts),
    completeness("country", "Country coverage", selectedContacts),
    completeness("hs_analytics_source", "Original source coverage", selectedContacts),
    completeness("gtm_icp_tier", "ICP tier coverage", selectedContacts),
    completeness("signalhire_match_status", "SignalHire enrichment", selectedContacts),
  ];

  const priorityContacts: ContactRow[] = selectedContacts.map((contact) => {
    const tier = value(contact, "gtm_icp_tier");
    const icpScore = number(value(contact, "gtm_icp_score"));
    const lastContacted = value(contact, "notes_last_contacted");
    const nextActivity = value(contact, "notes_next_activity_date");
    const emailStatus = value(contact, "gtm_email_status");
    const phoneStatus = value(contact, "phone_number_status");
    let priorityScore = Math.min(icpScore, 100) * 0.3;
    if (/^a$|tier a|high/i.test(tier)) priorityScore += 30;
    if (!lastContacted) priorityScore += 25;
    if (!nextActivity) priorityScore += 10;
    if (/valid|verified|deliverable/i.test(emailStatus)) priorityScore += 3;
    if (/correct|valid|verified/i.test(phoneStatus)) priorityScore += 2;
    return {
      id: contact.id,
      name: [value(contact, "firstname"), value(contact, "lastname")].filter(Boolean).join(" ") || "Unnamed contact",
      title: value(contact, "jobtitle"), company: value(contact, "company"), country: value(contact, "country"),
      originalSource: displayValue(value(contact, "hs_analytics_source"), originalSourceLabels),
      originalSourceDetail: value(contact, "hs_analytics_source_data_1") || "—",
      latestSource: displayValue(value(contact, "hs_latest_source"), latestSourceLabels),
      latestSourceDetail: value(contact, "hs_latest_source_data_1") || "—",
      recordSource: displayValue(value(contact, "hs_object_source_label"), recordSourceLabels),
      recordSourceDetail: value(contact, "hs_object_source_detail_1") || "—",
      leadSource: value(contact, "lead_source") || "—",
      contactSource: displayValue(value(contact, "contact_source"), contactSourceLabels),
      leadStatus: displayValue(value(contact, "hs_lead_status"), leadStatusLabels),
      lifecycleStage: displayValue(value(contact, "lifecyclestage"), lifecycleStageLabels),
      tier: displayValue(tier, tierLabels), persona: displayValue(value(contact, "gtm_persona"), personaLabels),
      emailStatus: emailStatus || "Unknown", phoneStatus: phoneStatus || "Unknown", lastContacted, nextActivity,
      priorityScore: Math.round(priorityScore), url: hubspotRecordUrl("contact", contact.id),
      companyUrl: value(contact, "company_id") ? hubspotRecordUrl("company", value(contact, "company_id")) : undefined,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 100);

  const companyRows: CompanyRow[] = companiesRaw.map((company) => ({
    id: company.id, name: value(company, "name") || "Unnamed company", domain: value(company, "domain"),
    country: value(company, "gtm_country") || value(company, "country"), industry: value(company, "gtm_industry") || value(company, "industry"),
    employees: value(company, "gtm_employee_count") || value(company, "numberofemployees"), tier: value(company, "company_tier"),
    ats: value(company, "detected_ats") || value(company, "ats_status"), atsCategory: value(company, "ats_category"),
    atsConfidence: value(company, "ats_confidence"), associatedContacts: companyContactCounts.get(company.id) ?? 0,
    url: hubspotRecordUrl("company", company.id),
  })).sort((a, b) => b.associatedContacts - a.associatedContacts);

  const dealRows: DealRow[] = dealsRaw.map((deal) => ({
    id: deal.id, name: value(deal, "dealname") || "Unnamed deal", stage: stageLabels.get(value(deal, "dealstage")) ?? pretty(value(deal, "dealstage")),
    owner: ownerMap.get(value(deal, "hubspot_owner_id")) ?? value(deal, "hubspot_owner_id"),
    amount: number(value(deal, "amount_in_home_currency") || value(deal, "amount")), closeDate: value(deal, "closedate"),
    url: hubspotRecordUrl("deal", deal.id),
  })).sort((a, b) => b.amount - a.amount);

  const taskRecords = [...new Map(
    [...tasksDue, ...tasksCompleted, ...openTasks].map((task) => [task.id, task]),
  ).values()];
  const recentActivities: ActivityRow[] = [
    ...calls.map((call): ActivityRow => ({
      id: call.id,
      type: "Call",
      subject: value(call, "hs_call_title") || "Logged call",
      status: CALL_DISPOSITION_LABELS[value(call, "hs_call_disposition")] ?? pretty(value(call, "hs_call_status")),
      detail: CALL_DISPOSITION_LABELS[value(call, "hs_call_disposition")] ?? "No disposition",
      assignedTo: ownerMap.get(value(call, "hubspot_owner_id")) ?? ownerName,
      occurredAt: value(call, "hs_timestamp"),
      url: hubspotRecordUrl("call", call.id),
    })),
    ...meetingGroups.map((meeting): ActivityRow => ({
      id: meeting.booking.id,
      type: "Meeting",
      subject: value(meeting.booking, "hs_meeting_title") || "Meeting",
      status: displayValue(meeting.outcome, meetingOutcomeLabels),
      detail: displayValue(meeting.source, meetingSourceLabels),
      assignedTo: ownerMap.get(meeting.ownerId) ?? (meeting.ownerId || "Unassigned"),
      occurredAt: meeting.startAt || meeting.createdAt,
      url: hubspotRecordUrl("meeting", meeting.booking.id),
    })),
    ...taskRecords.map((task): ActivityRow => ({
      id: task.id,
      type: "Task",
      subject: value(task, "hs_task_subject") || "Task",
      status: displayValue(value(task, "hs_task_status"), taskStatusLabels),
      detail: pretty(value(task, "hs_task_priority") || "Normal priority"),
      assignedTo: ownerMap.get(value(task, "hubspot_owner_id")) ?? ownerName,
      occurredAt: value(task, "hs_task_completion_date") || value(task, "hs_timestamp") || value(task, "hs_createdate"),
      url: hubspotRecordUrl("task", task.id),
    })),
    ...outgoingEmails.map((email): ActivityRow => ({
      id: email.id,
      type: "Email",
      subject: value(email, "hs_email_subject") || "Sales email",
      status: pretty(value(email, "hs_email_status") || "Sent"),
      detail: number(value(email, "hs_email_reply_count")) > 0 ? "Replied" : "No reply",
      assignedTo: ownerMap.get(value(email, "hubspot_owner_id")) ?? ownerName,
      occurredAt: value(email, "hs_timestamp"),
      url: hubspotRecordUrl("email", email.id),
    })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).slice(0, 100);

  const highIcpUntouched = selectedContacts.filter((contact) => /^a$|tier a|high/i.test(value(contact, "gtm_icp_tier")) && !value(contact, "notes_last_contacted")).length;
  const wrongPhones = selectedContacts.filter((contact) => /wrong/i.test(value(contact, "phone_number_status"))).length;
  const missingMeetingOutcomes = meetingGroups.filter((meeting) => meeting.outcome === "UNKNOWN").length;
  const alertCandidates: AlertItem[] = [
    { id: "due-tomorrow", severity: dueTomorrow > 75 ? "critical" : "warning", title: "Tasks due tomorrow", detail: "Review capacity and redistribute overloaded days.", count: dueTomorrow, action: "Open task workload" },
    { id: "overdue", severity: overdueTasks ? "critical" : "info", title: "Overdue tasks", detail: "Open tasks with a due date before now.", count: overdueTasks, action: "Clear overdue queue" },
    { id: "high-icp", severity: highIcpUntouched ? "critical" : "info", title: "Tier A untouched", detail: "High-value leads with no logged outreach.", count: highIcpUntouched, action: "Start outreach" },
    { id: "wrong-phone", severity: wrongPhones ? "warning" : "info", title: "Wrong phone numbers", detail: "Contacts that need SignalHire fallback enrichment.", count: wrongPhones, action: "Run enrichment" },
    { id: "meeting-outcomes", severity: missingMeetingOutcomes ? "warning" : "info", title: "Missing meeting outcomes", detail: "Deduplicated meetings without a final outcome.", count: missingMeetingOutcomes, action: "Update outcomes" },
    { id: "missing-source", severity: "warning", title: "Missing original source", detail: "Contacts without first-touch attribution.", count: selectedContacts.filter((contact) => !value(contact, "hs_analytics_source")).length, action: "Audit imports" },
  ];
  const alerts = alertCandidates.filter((alert) => alert.count > 0);

  const meetingOwnerCounts = new Map<string, number>();
  const meetingOutcomeCounts = new Map<string, number>();
  const meetingSourceCounts = new Map<string, number>();
  for (const meeting of meetingGroups) {
    const assigned = ownerMap.get(meeting.ownerId) ?? (meeting.ownerId || "Unassigned");
    meetingOwnerCounts.set(assigned, (meetingOwnerCounts.get(assigned) ?? 0) + 1);
    const outcome = displayValue(meeting.outcome, meetingOutcomeLabels); meetingOutcomeCounts.set(outcome, (meetingOutcomeCounts.get(outcome) ?? 0) + 1);
    const source = displayValue(meeting.source, meetingSourceLabels); meetingSourceCounts.set(source, (meetingSourceCounts.get(source) ?? 0) + 1);
  }
  const mapToChart = (map: Map<string, number>) => [...map.entries()].map(([name, itemValue]) => ({ name, value: itemValue })).sort((a, b) => b.value - a.value);

  const connectedContactIds = new Set(connectedCalls.flatMap((call) => callContacts.get(call.id) ?? []).filter((id) => selectedIds.has(id)));
  const meetingContactIds = new Set(meetingGroups.flatMap((meeting) => meeting.contactIds).filter((id) => selectedIds.has(id)));
  const contactedCount = selectedContacts.filter((contact) => Boolean(value(contact, "notes_last_contacted"))).length;

  return {
    meta: {
      generatedAt: new Date().toISOString(), from: filters.from, to: filters.to, timezone: HUBSPOT_TIMEZONE,
      ownerId: filters.ownerId, ownerName, portalId: HUBSPOT_PORTAL_ID, isDemo: false, warnings,
      hubspotUrls: {
        contacts: hubspotListUrl("contact"), companies: hubspotListUrl("company"), calls: hubspotListUrl("call"),
        meetings: hubspotListUrl("meeting"), tasks: hubspotListUrl("task"), emails: hubspotListUrl("email"), deals: hubspotListUrl("deal"),
      },
    },
    kpis: {
      portfolioContacts: selectedContacts.length, newContacts: newContacts.length, companies: companiesRaw.length,
      calls: calls.length, connectedCalls: connectedCalls.length, connectionRate: calls.length ? Math.round((connectedCalls.length / calls.length) * 1000) / 10 : 0,
      bookedMeetings: meetingGroups.length, completedMeetings, meetingCompletionRate: meetingGroups.length ? Math.round((completedMeetings / meetingGroups.length) * 1000) / 10 : 0,
      openTasks: openTasks.length, overdueTasks, dueTomorrow, completedTasks: tasksCompleted.length,
      emailsSent: outgoingEmails.length, emailReplies, emailReplyRate: outgoingEmails.length ? Math.round((emailReplies / outgoingEmails.length) * 1000) / 10 : 0,
      dealsCreated: dealsCreated.length, openDeals: openDeals.length, pipelineValue: openDeals.reduce((sum, deal) => sum + number(value(deal, "amount_in_home_currency") || value(deal, "amount")), 0),
      untouchedContacts, nextActivityCoverage: selectedContacts.length ? Math.round((nextActivityCount / selectedContacts.length) * 1000) / 10 : 0,
    },
    dailyActivities: [...dailyMap.values()],
    funnel: [
      { name: "Portfolio", value: selectedContacts.length }, { name: "Contacted", value: contactedCount },
      { name: "Connected", value: connectedContactIds.size }, { name: "Meeting", value: meetingContactIds.size },
      { name: "Deal", value: dealsRaw.length }, { name: "Open Deal", value: openDeals.length },
    ],
    originalSources: countBy(sourceContacts, (record) => value(record, "hs_analytics_source"), originalSourceLabels),
    latestSources: countBy(sourceContacts, (record) => value(record, "hs_latest_source"), latestSourceLabels),
    recordSources: countBy(sourceContacts, (record) => value(record, "hs_object_source_label"), recordSourceLabels),
    integrationSources: countBy(integrationContacts, (record) => value(record, "hs_object_source_detail_1")),
    sourceAudit: {
      integrationRecords: integrationContacts.length,
      extensiveLighterRecords: extensiveLighterContacts.length,
      formRecords: formContacts.length,
      apiShare: sourceContacts.length ? Math.round((integrationContacts.length / sourceContacts.length) * 1000) / 10 : 0,
    },
    leadStatuses: countBy(selectedContacts, (record) => value(record, "hs_lead_status"), leadStatusLabels),
    lifecycleStages: countBy(selectedContacts, (record) => value(record, "lifecyclestage"), lifecycleStageLabels),
    callOutcomes: countBy(calls, (record) => value(record, "hs_call_disposition"), CALL_DISPOSITION_LABELS),
    meetingOutcomes: mapToChart(meetingOutcomeCounts), meetingOwners: mapToChart(meetingOwnerCounts), meetingSources: mapToChart(meetingSourceCounts),
    taskStatuses: countBy([...openTasks, ...tasksCompleted], (record) => value(record, "hs_task_status"), taskStatusLabels),
    emailPerformance: [
      { name: "Sent", value: outgoingEmails.length }, { name: "Opened", value: outgoingEmails.filter((email) => number(value(email, "hs_email_open_count")) > 0).length },
      { name: "Clicked", value: outgoingEmails.filter((email) => number(value(email, "hs_email_click_count")) > 0).length }, { name: "Replied", value: emailReplies },
    ],
    countries: countBy(companiesRaw, (record) => value(record, "gtm_country") || value(record, "country")),
    industries: countBy(companiesRaw, (record) => value(record, "gtm_industry") || value(record, "industry")).slice(0, 15),
    atsPlatforms: countBy(companiesRaw, (record) => value(record, "detected_ats") || value(record, "ats_status")).slice(0, 15),
    dealStages: dealRows.reduce<ChartDatum[]>((acc, deal) => {
      const existing = acc.find((item) => item.name === deal.stage);
      if (existing) { existing.value += 1; existing.amount = (existing.amount ?? 0) + deal.amount; } else acc.push({ name: deal.stage, value: 1, amount: deal.amount });
      return acc;
    }, []).sort((a, b) => b.value - a.value),
    quality, alerts, priorityContacts, recentActivities, companies: companyRows.slice(0, 200), deals: dealRows.slice(0, 200),
    filterOptions: {
      countries: uniqueOptions(allContacts, "country"), originalSources: uniqueOptions(allContacts, "hs_analytics_source", originalSourceLabels),
      latestSources: uniqueOptions(allContacts, "hs_latest_source", latestSourceLabels), tiers: uniqueOptions(allContacts, "gtm_icp_tier", tierLabels),
      personas: uniqueOptions(allContacts, "gtm_persona", personaLabels), owners,
    },
  };
}
