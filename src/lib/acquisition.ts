import {
  ACQUISITION_OWNER_IDS,
  CALL_DISPOSITION_LABELS,
  CALL_PROPERTIES,
  CONNECTED_CALL_DISPOSITION,
  CONTACT_PROPERTIES,
  DEAL_PROPERTIES,
  HUBSPOT_TIMEZONE,
  MEETING_PROPERTIES,
  TASK_PROPERTIES,
  hubspotListUrl,
  hubspotRecordUrl,
} from "@/lib/config";
import {
  describeHubSpotError,
  getPropertyDefinitions,
  listDealStages,
  listOwners,
  readAssociations,
  searchAllByPropertyValues,
  type HubSpotPropertyDefinition,
  type SearchFilter,
} from "@/lib/hubspot";
import type {
  AcquisitionData,
  AcquisitionFocus,
  AcquisitionPeriodMetrics,
  AcquisitionRepSummary,
  ActivityRow,
  ChartDatum,
  ContactRow,
  DealRow,
  HubSpotOwner,
  HubSpotRecord,
} from "@/lib/types";

const REP_COLORS = ["#744bc4", "#3a7de0", "#c52d69", "#b95b16", "#087a50", "#197f94", "#56677e", "#1aa6a0"];
const ACQUISITION_OWNER_FALLBACKS: Record<string, HubSpotOwner> = {
  "31644369": { id: "31644369", name: "Marita Chedid" },
  "31558980": { id: "31558980", name: "Zein Fares" },
  "76369997": { id: "76369997", name: "Ursula Waked" },
  "32332250": { id: "32332250", name: "Ahmad Khawajah" },
  "32332251": { id: "32332251", name: "Mohammed Khalid" },
  "76370000": { id: "76370000", name: "Mohammad Jehad Al-Bargawi" },
  "76369998": { id: "76369998", name: "Fadi Zanona" },
  "76369995": { id: "76369995", name: "Mohammed Faizan" },
};

function value(record: HubSpotRecord, key: string) {
  return record.properties[key]?.trim() ?? "";
}

function number(raw: string) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pretty(raw: string) {
  if (!raw) return "Unknown";
  return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function localDay(raw: string) {
  if (!raw) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HUBSPOT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(raw));
}

function addDays(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function inPeriod(raw: string, from: string, to: string) {
  const day = localDay(raw);
  return Boolean(day && day >= from && day <= to);
}

function dateFilters(from?: string, dateProperty?: string): SearchFilter[] {
  return from && dateProperty
    ? [{ propertyName: dateProperty, operator: "GTE", value: `${from}T00:00:00+03:00` }]
    : [];
}

function searchOwnedRecords(
  objectType: string,
  properties: readonly string[],
  from?: string,
  dateProperty?: string,
  sorts: string[] = [],
) {
  return searchAllByPropertyValues(
    objectType,
    properties,
    "hubspot_owner_id",
    ACQUISITION_OWNER_IDS,
    dateFilters(from, dateProperty),
    sorts,
  );
}

async function optional<T>(label: string, warnings: string[], action: () => Promise<T>, fallback: T) {
  try {
    return await action();
  } catch (error) {
    warnings.push(`${label}: ${describeHubSpotError(error)}`);
    return fallback;
  }
}

function propertyLabels(definitions: HubSpotPropertyDefinition[], propertyName: string) {
  return Object.fromEntries(
    (definitions.find((definition) => definition.name === propertyName)?.options ?? [])
      .filter((option) => !option.hidden)
      .map((option) => [option.value, option.label]),
  );
}

function label(raw: string, labels: Record<string, string>) {
  return labels[raw] ?? pretty(raw);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "—";
}

function activityContact(
  ids: string[],
  contactNames: Map<string, string>,
  fallbackType: "call" | "meeting" | "task",
) {
  const contactId = ids[0];
  if (!contactId) return { url: hubspotListUrl(fallbackType) };
  const url = hubspotRecordUrl("contact", contactId);
  return {
    relatedContactId: contactId,
    relatedContactName: contactNames.get(contactId) ?? `Contact #${contactId}`,
    relatedContactUrl: url,
    url,
  };
}

function dedupe(records: HubSpotRecord[]) {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function ownerDirectory(owners: HubSpotOwner[]) {
  const directory = new Map<string, HubSpotOwner>(owners.map((owner) => [owner.id, owner]));
  for (const ownerId of ACQUISITION_OWNER_IDS) {
    if (!directory.has(ownerId) && ACQUISITION_OWNER_FALLBACKS[ownerId]) {
      directory.set(ownerId, ACQUISITION_OWNER_FALLBACKS[ownerId]);
    }
  }
  return directory;
}

export function createMockAcquisitionDashboard(): AcquisitionData {
  const today = localDay(new Date().toISOString());
  const yesterday = addDays(today, -1);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const period = (from: string, to: string): AcquisitionPeriodMetrics => ({
    from, to, contacts: 0, calls: 0, connectedCalls: 0, connectionRate: 0,
    meetingsBooked: 0, meetingsCompleted: 0, tasksCompleted: 0,
    dealsCreated: 0, dealsWon: 0, dealsLost: 0, pipelineCreated: 0,
  });
  const focus: AcquisitionFocus = {
    leadsNeedContact: 0, rankABUntouched: 0, dealsAtRisk: 0, contactedLeads: 0,
    eligibleLeads: 0, contactRate: 0, openDeals: 0, openPipeline: 0,
  };
  const summary = (ownerId = "all", index = 0): AcquisitionRepSummary => {
    const fallback = ACQUISITION_OWNER_FALLBACKS[ownerId];
    const name = ownerId === "all" ? "Team Overview" : fallback?.name ?? `Owner ${ownerId}`;
    return {
      ownerId, name, email: fallback?.email ?? "", initials: ownerId === "all" ? "TM" : initials(name),
      color: ownerId === "all" ? "#087a50" : REP_COLORS[index % REP_COLORS.length], focus,
      yesterday: period(yesterday, yesterday), mtd: period(monthStart, today), ytd: period(yearStart, today),
    };
  };
  return {
    meta: {
      generatedAt: new Date().toISOString(), timezone: HUBSPOT_TIMEZONE, yesterday, monthStart, yearStart, today,
      isDemo: true, warnings: ["Demo mode is active. Connect HubSpot to load Acquisition data."],
      hubspotUrls: {
        contacts: hubspotListUrl("contact"), calls: hubspotListUrl("call"), meetings: hubspotListUrl("meeting"),
        tasks: hubspotListUrl("task"), deals: hubspotListUrl("deal"),
      },
    },
    team: summary(), reps: ACQUISITION_OWNER_IDS.map((ownerId, index) => summary(ownerId, index)),
    contacts: [], activities: [], deals: [], leadSources: [], dealStages: [],
  };
}

export async function buildAcquisitionDashboard(): Promise<AcquisitionData> {
  const warnings: string[] = [];
  const today = localDay(new Date().toISOString());
  const yesterday = addDays(today, -1);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const [
    contacts,
    calls,
    meetings,
    tasksCompleted,
    deals,
    owners,
    dealStageLabels,
    contactDefinitions,
  ] = await Promise.all([
    optional("Contacts", warnings, () => searchOwnedRecords("contacts", CONTACT_PROPERTIES, undefined, undefined, ["createdate"]), []),
    optional("Calls", warnings, () => searchOwnedRecords("calls", CALL_PROPERTIES, yearStart, "hs_timestamp", ["hs_timestamp"]), []),
    optional("Meetings", warnings, () => searchOwnedRecords("meetings", MEETING_PROPERTIES, undefined, undefined, ["hs_createdate"]), []),
    optional("Completed tasks", warnings, () => searchOwnedRecords("tasks", TASK_PROPERTIES, yearStart, "hs_task_completion_date", ["hs_task_completion_date"]), []),
    optional("Deals", warnings, () => searchOwnedRecords("deals", DEAL_PROPERTIES, undefined, undefined, ["createdate"]), []),
    optional("Owners", warnings, () => listOwners(), [] as HubSpotOwner[]),
    optional("Deal stages", warnings, () => listDealStages(), new Map<string, string>()),
    optional("Contact labels", warnings, () => getPropertyDefinitions("contacts", [
      "hs_analytics_source", "hs_latest_source", "hs_object_source_label", "hs_lead_status",
      "lifecyclestage", "contact_source", "gtm_icp_tier", "gtm_contact_priority",
      "gtm_persona", "gtm_email_status", "phone_number_status",
    ]), [] as HubSpotPropertyDefinition[]),
  ]);

  const uniqueMeetings = dedupe(meetings);
  const ownerMap = ownerDirectory(owners);
  const originalSourceLabels = propertyLabels(contactDefinitions, "hs_analytics_source");
  const latestSourceLabels = propertyLabels(contactDefinitions, "hs_latest_source");
  const recordSourceLabels = propertyLabels(contactDefinitions, "hs_object_source_label");
  const leadStatusLabels = propertyLabels(contactDefinitions, "hs_lead_status");
  const lifecycleLabels = propertyLabels(contactDefinitions, "lifecyclestage");
  const contactSourceLabels = propertyLabels(contactDefinitions, "contact_source");
  const tierLabels = propertyLabels(contactDefinitions, "gtm_icp_tier");
  const priorityLabels = propertyLabels(contactDefinitions, "gtm_contact_priority");
  const personaLabels = propertyLabels(contactDefinitions, "gtm_persona");
  const emailStatusLabels = propertyLabels(contactDefinitions, "gtm_email_status");
  const phoneStatusLabels = propertyLabels(contactDefinitions, "phone_number_status");

  const contactNames = new Map(contacts.map((contact) => [
    contact.id,
    [value(contact, "firstname"), value(contact, "lastname")].filter(Boolean).join(" ") || "Unnamed contact",
  ]));
  const [callContacts, meetingContacts, taskContacts] = await Promise.all([
    optional("Call associations", warnings, () => readAssociations("calls", "contacts", calls.map((record) => record.id)), new Map<string, string[]>()),
    optional("Meeting associations", warnings, () => readAssociations("meetings", "contacts", uniqueMeetings.map((record) => record.id)), new Map<string, string[]>()),
    optional("Task associations", warnings, () => readAssociations("tasks", "contacts", tasksCompleted.map((record) => record.id)), new Map<string, string[]>()),
  ]);

  const connectedContactIds = new Set(calls
    .filter((call) => value(call, "hs_call_disposition") === CONNECTED_CALL_DISPOSITION)
    .flatMap((call) => callContacts.get(call.id) ?? []));
  const meetingContactIds = new Set(uniqueMeetings.flatMap((meeting) => meetingContacts.get(meeting.id) ?? []));

  const contactRows: ContactRow[] = contacts.map((contact) => {
    const ownerId = value(contact, "hubspot_owner_id");
    const owner = ownerMap.get(ownerId);
    const lastContacted = value(contact, "notes_last_contacted");
    const nextActivity = value(contact, "notes_next_activity_date");
    const tierRaw = value(contact, "gtm_icp_tier");
    const emailStatusRaw = value(contact, "gtm_email_status");
    const phoneStatusRaw = value(contact, "phone_number_status");
    const responseRaw = value(contact, "hs_time_to_first_engagement");
    const responseMilliseconds = Number(responseRaw);
    const priorityScore = Math.max(0, Math.min(100,
      (/(tier_1|tier 1|tier a|rank a)/i.test(tierRaw) ? 40 : /(tier_2|tier 2|tier b|rank b)/i.test(tierRaw) ? 25 : 10)
      + (!lastContacted ? 25 : 0)
      + (!nextActivity ? 15 : 0)
      + (value(contact, "phone") || value(contact, "mobilephone") ? 10 : 0)
      + (value(contact, "email") ? 10 : 0),
    ));
    return {
      id: contact.id,
      ownerId,
      ownerName: owner?.name ?? ownerId,
      name: contactNames.get(contact.id) ?? "Unnamed contact",
      email: value(contact, "email"),
      phone: value(contact, "phone") || value(contact, "mobilephone"),
      linkedinUrl: value(contact, "gtm_linkedin_url"),
      title: value(contact, "jobtitle"),
      company: value(contact, "company"),
      country: value(contact, "country"),
      originalSource: label(value(contact, "hs_analytics_source"), originalSourceLabels),
      originalSourceDetail: value(contact, "hs_analytics_source_data_1") || "—",
      latestSource: label(value(contact, "hs_latest_source"), latestSourceLabels),
      latestSourceDetail: value(contact, "hs_latest_source_data_1") || "—",
      recordSource: label(value(contact, "hs_object_source_label"), recordSourceLabels),
      recordSourceDetail: value(contact, "hs_object_source_detail_1") || "—",
      leadSource: value(contact, "lead_source") || "—",
      contactSource: label(value(contact, "contact_source"), contactSourceLabels),
      leadStatus: label(value(contact, "hs_lead_status"), leadStatusLabels),
      lifecycleStage: label(value(contact, "lifecyclestage"), lifecycleLabels),
      tier: label(tierRaw, tierLabels),
      contactPriority: label(value(contact, "gtm_contact_priority"), priorityLabels),
      persona: label(value(contact, "gtm_persona"), personaLabels),
      emailStatus: label(emailStatusRaw, emailStatusLabels),
      phoneStatus: label(phoneStatusRaw, phoneStatusLabels),
      createdAt: value(contact, "createdate"),
      lastContacted,
      nextActivity,
      leadResponseTimeHours: responseRaw && Number.isFinite(responseMilliseconds)
        ? Math.round((responseMilliseconds / 3_600_000) * 10) / 10
        : null,
      hasConnectedCall: connectedContactIds.has(contact.id),
      hasMeeting: meetingContactIds.has(contact.id),
      hasDeal: false,
      hasOpenDeal: false,
      qualityIssues: [
        !value(contact, "email") && "email",
        !(value(contact, "phone") || value(contact, "mobilephone")) && "phone",
        !value(contact, "country") && "country",
        !value(contact, "hs_analytics_source") && "hs_analytics_source",
      ].filter((item): item is string => Boolean(item)),
      priorityScore,
      url: hubspotRecordUrl("contact", contact.id),
      companyUrl: value(contact, "company_id") ? hubspotRecordUrl("company", value(contact, "company_id")) : undefined,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  const dealRows: DealRow[] = deals.map((deal) => {
    const ownerId = value(deal, "hubspot_owner_id");
    return {
      id: deal.id,
      ownerId,
      name: value(deal, "dealname") || "Unnamed deal",
      stage: dealStageLabels.get(value(deal, "dealstage")) ?? pretty(value(deal, "dealstage")),
      owner: ownerMap.get(ownerId)?.name ?? ownerId,
      amount: number(value(deal, "amount_in_home_currency") || value(deal, "amount")),
      createdAt: value(deal, "createdate"),
      closeDate: value(deal, "closedate"),
      isOpen: value(deal, "hs_is_closed") !== "true",
      isWon: value(deal, "hs_is_closed_won") === "true",
      nextActivity: value(deal, "notes_next_activity_date"),
      url: hubspotRecordUrl("deal", deal.id),
    };
  }).sort((a, b) => b.amount - a.amount);

  const activityRows: ActivityRow[] = [
    ...calls.map((call): ActivityRow => {
      const ownerId = value(call, "hubspot_owner_id");
      const disposition = CALL_DISPOSITION_LABELS[value(call, "hs_call_disposition")] ?? pretty(value(call, "hs_call_status"));
      return {
        id: call.id, ownerId, type: "Call", subject: value(call, "hs_call_title") || "Logged call",
        status: disposition, detail: disposition || "No disposition", assignedTo: ownerMap.get(ownerId)?.name ?? ownerId,
        occurredAt: value(call, "hs_timestamp"), metricAt: value(call, "hs_timestamp"), dueAt: "", dueBucket: "",
        isOpen: false, isHighPriority: false, opened: false, clicked: false, replied: false,
        ...activityContact(callContacts.get(call.id) ?? [], contactNames, "call"),
      };
    }),
    ...uniqueMeetings.map((meeting): ActivityRow => {
      const ownerId = value(meeting, "hubspot_owner_id");
      const occurredAt = value(meeting, "hs_meeting_start_time") || value(meeting, "hs_timestamp") || value(meeting, "hs_createdate");
      const outcome = pretty(value(meeting, "hs_meeting_outcome") || "Scheduled");
      return {
        id: meeting.id, ownerId, type: "Meeting", subject: value(meeting, "hs_meeting_title") || "Meeting",
        status: outcome, detail: pretty(value(meeting, "hs_meeting_source") || "CRM UI"), assignedTo: ownerMap.get(ownerId)?.name ?? ownerId,
        occurredAt, metricAt: value(meeting, "hs_createdate") || occurredAt, dueAt: "", dueBucket: "",
        isOpen: !/completed|canceled/i.test(outcome), isHighPriority: false, opened: false, clicked: false, replied: false,
        ...activityContact(meetingContacts.get(meeting.id) ?? [], contactNames, "meeting"),
      };
    }),
    ...tasksCompleted.map((task): ActivityRow => {
      const ownerId = value(task, "hubspot_owner_id");
      const occurredAt = value(task, "hs_task_completion_date") || value(task, "hs_timestamp");
      return {
        id: task.id, ownerId, type: "Task", subject: value(task, "hs_task_subject") || "Completed task",
        status: "Completed", detail: pretty(value(task, "hs_task_priority") || "Normal"), assignedTo: ownerMap.get(ownerId)?.name ?? ownerId,
        occurredAt, metricAt: occurredAt, dueAt: value(task, "hs_timestamp"), dueBucket: "Completed",
        isOpen: false, isHighPriority: value(task, "hs_task_priority") === "HIGH", opened: false, clicked: false, replied: false,
        ...activityContact(taskContacts.get(task.id) ?? [], contactNames, "task"),
      };
    }),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const ownerMatches = (record: HubSpotRecord, ownerId?: string) => !ownerId || value(record, "hubspot_owner_id") === ownerId;
  const periodMetrics = (from: string, to: string, ownerId?: string): AcquisitionPeriodMetrics => {
    const periodContacts = contacts.filter((record) => ownerMatches(record, ownerId) && inPeriod(value(record, "createdate"), from, to));
    const periodCalls = calls.filter((record) => ownerMatches(record, ownerId) && inPeriod(value(record, "hs_timestamp"), from, to));
    const connectedCalls = periodCalls.filter((record) => value(record, "hs_call_disposition") === CONNECTED_CALL_DISPOSITION);
    const bookedMeetings = uniqueMeetings.filter((record) => ownerMatches(record, ownerId) && inPeriod(value(record, "hs_createdate"), from, to));
    const completedMeetings = uniqueMeetings.filter((record) => ownerMatches(record, ownerId)
      && value(record, "hs_meeting_outcome") === "COMPLETED"
      && inPeriod(value(record, "hs_meeting_start_time") || value(record, "hs_timestamp"), from, to));
    const completedTasks = tasksCompleted.filter((record) => ownerMatches(record, ownerId)
      && inPeriod(value(record, "hs_task_completion_date"), from, to));
    const createdDeals = deals.filter((record) => ownerMatches(record, ownerId) && inPeriod(value(record, "createdate"), from, to));
    const wonDeals = deals.filter((record) => ownerMatches(record, ownerId) && value(record, "hs_is_closed_won") === "true"
      && inPeriod(value(record, "closedate"), from, to));
    const lostDeals = deals.filter((record) => ownerMatches(record, ownerId) && value(record, "hs_is_closed") === "true"
      && value(record, "hs_is_closed_won") !== "true" && inPeriod(value(record, "closedate"), from, to));
    return {
      from, to, contacts: periodContacts.length, calls: periodCalls.length, connectedCalls: connectedCalls.length,
      connectionRate: periodCalls.length ? Math.round((connectedCalls.length / periodCalls.length) * 1000) / 10 : 0,
      meetingsBooked: bookedMeetings.length, meetingsCompleted: completedMeetings.length, tasksCompleted: completedTasks.length,
      dealsCreated: createdDeals.length, dealsWon: wonDeals.length, dealsLost: lostDeals.length,
      pipelineCreated: createdDeals.reduce((sum, deal) => sum + number(value(deal, "amount_in_home_currency") || value(deal, "amount")), 0),
    };
  };

  const focus = (ownerId?: string): AcquisitionFocus => {
    const ownedContacts = contacts.filter((record) => ownerMatches(record, ownerId));
    const ownedDeals = deals.filter((record) => ownerMatches(record, ownerId));
    const untouched = ownedContacts.filter((record) => !value(record, "notes_last_contacted"));
    const rankABUntouched = untouched.filter((record) => /(tier_1|tier_2|tier 1|tier 2|tier a|tier b|rank a|rank b)/i.test(value(record, "gtm_icp_tier")));
    const openDeals = ownedDeals.filter((record) => value(record, "hs_is_closed") !== "true");
    const dealsAtRisk = openDeals.filter((record) => {
      const closeDay = localDay(value(record, "closedate"));
      return Boolean((closeDay && closeDay < today) || !value(record, "notes_next_activity_date"));
    });
    const contacted = ownedContacts.length - untouched.length;
    return {
      leadsNeedContact: untouched.length,
      rankABUntouched: rankABUntouched.length,
      dealsAtRisk: dealsAtRisk.length,
      contactedLeads: contacted,
      eligibleLeads: ownedContacts.length,
      contactRate: ownedContacts.length ? Math.round((contacted / ownedContacts.length) * 1000) / 10 : 0,
      openDeals: openDeals.length,
      openPipeline: openDeals.reduce((sum, deal) => sum + number(value(deal, "amount_in_home_currency") || value(deal, "amount")), 0),
    };
  };

  const makeSummary = (ownerId?: string, index = 0): AcquisitionRepSummary => {
    const owner = ownerId ? ownerMap.get(ownerId) : undefined;
    const name = owner?.name ?? (ownerId ? ACQUISITION_OWNER_FALLBACKS[ownerId]?.name ?? `Owner ${ownerId}` : "Team Overview");
    return {
      ownerId: ownerId ?? "all",
      name,
      email: owner?.email ?? "",
      initials: ownerId ? initials(name) : "TM",
      color: ownerId ? REP_COLORS[index % REP_COLORS.length] : "#087a50",
      focus: focus(ownerId),
      yesterday: periodMetrics(yesterday, yesterday, ownerId),
      mtd: periodMetrics(monthStart, today, ownerId),
      ytd: periodMetrics(yearStart, today, ownerId),
    };
  };

  const reps = ACQUISITION_OWNER_IDS.map((ownerId, index) => makeSummary(ownerId, index));
  const ytdContacts = contactRows.filter((contact) => inPeriod(contact.createdAt, yearStart, today));
  const leadSourceCounts = new Map<string, number>();
  for (const contact of ytdContacts) leadSourceCounts.set(contact.originalSource, (leadSourceCounts.get(contact.originalSource) ?? 0) + 1);
  const leadSources: ChartDatum[] = [...leadSourceCounts.entries()]
    .map(([name, count]) => ({ name, value: count }))
    .sort((a, b) => b.value - a.value);
  const dealStageCounts = new Map<string, { value: number; amount: number }>();
  for (const deal of dealRows.filter((row) => row.isOpen)) {
    const current = dealStageCounts.get(deal.stage) ?? { value: 0, amount: 0 };
    dealStageCounts.set(deal.stage, { value: current.value + 1, amount: current.amount + deal.amount });
  }
  const dealStages: ChartDatum[] = [...dealStageCounts.entries()]
    .map(([name, totals]) => ({ name, value: totals.value, amount: totals.amount }))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  return {
    meta: {
      generatedAt: new Date().toISOString(), timezone: HUBSPOT_TIMEZONE, yesterday, monthStart, yearStart, today,
      isDemo: false, warnings,
      hubspotUrls: {
        contacts: hubspotListUrl("contact"), calls: hubspotListUrl("call"), meetings: hubspotListUrl("meeting"),
        tasks: hubspotListUrl("task"), deals: hubspotListUrl("deal"),
      },
    },
    team: makeSummary(),
    reps,
    contacts: contactRows,
    activities: activityRows,
    deals: dealRows,
    leadSources,
    dealStages,
  };
}
