import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CALL_PROPERTIES,
  COMMUNICATION_PROPERTIES,
  DEAL_PROPERTIES,
  EMAIL_PROPERTIES,
  HUBSPOT_TIMEZONE,
  MEETING_PROPERTIES,
  hubspotRecordUrl,
} from "@/lib/config";
import { compressedJsonResponse } from "@/lib/compressed-json";
import {
  batchRead,
  listDealStages,
  listOwners,
  readAssociations,
  searchAll,
  type SearchFilter,
} from "@/lib/hubspot";
import { meetingCreatorId } from "@/lib/owner-attribution";
import { SALES_REP_OWNER_IDS } from "@/lib/sales-reps";
import { SDR_OWNERS } from "@/lib/sdr-owners";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_SALES_REP_ID = "76369997"; // Ursula Waked / Orsla 1
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;
const FOLLOW_UP_DAYS = 90;
const MAX_REPORT_DAYS = 180;
const OUTCOME_PRIORITY = ["COMPLETED", "NO_SHOW", "CANCELED", "RESCHEDULED", "SCHEDULED"];
const MARITA_BOOKING_MARKER = "booked by marita";

const HANDOFF_MEETING_PROPERTIES = [
  ...MEETING_PROPERTIES,
  "hs_internal_meeting_notes",
  "hs_meeting_body",
] as const;

const HANDOFF_CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "company",
  "company_id",
  "notes_last_contacted",
  "hs_last_sales_activity_timestamp",
  "notes_next_activity_date",
  "hubspot_owner_id",
] as const;

const HANDOFF_COMPANY_PROPERTIES = ["name", "domain", "country"] as const;

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  salesRepId: z.string().regex(/^\d+$/),
});

type FollowUpStatus = "Within 24h" | "24–48h" | "48h+" | "No follow-up";
type AttentionLevel = "critical" | "warning" | "ok";
type FollowUpType = "Call" | "Email" | "WhatsApp" | "Meeting";

type ActivityEvent = {
  id: string;
  type: FollowUpType;
  at: string;
  detail: string;
};

type MeetingGroup = {
  id: string;
  title: string;
  outcome: string;
  startAt: string;
  endAt: string;
  contactIds: string[];
  maritaCreated: boolean;
};

type HandoffDeal = {
  id: string;
  name: string;
  stage: string;
  owner: string;
  amount: number;
  createdAt: string;
  closeDate: string;
  nextActivity: string;
  isOpen: boolean;
  isClosedWon: boolean;
  url: string;
};

type HandoffRow = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  meetingEnd: string;
  outcome: string;
  contacts: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    url: string;
  }>;
  company: {
    id: string;
    name: string;
    domain: string;
    url: string;
  } | null;
  followUp: {
    status: FollowUpStatus;
    hours: number | null;
    type: FollowUpType | null;
    at: string;
    detail: string;
  };
  lastSalesActivity: string;
  nextActivity: string;
  deal: HandoffDeal | null;
  dealCreatedAfterMeeting: boolean;
  attention: {
    level: AttentionLevel;
    reason: string;
  };
  recordUrl: string;
};

type HandoffPayload = {
  meta: {
    generatedAt: string;
    from: string;
    to: string;
    timezone: string;
    sdr: { id: string; name: string };
    salesRep: { id: string; name: string };
    salesReps: Array<{ id: string; name: string }>;
    followUpDays: number;
    cache: "hit" | "miss";
  };
  kpis: {
    meetings: number;
    completed: number;
    followedUp: number;
    followUpRate: number;
    deals: number;
    openDeals: number;
    closedWon: number;
    pipelineValue: number;
    needsAttention: number;
  };
  rows: HandoffRow[];
};

type CacheEntry = {
  expiresAt: number;
  payload: HandoffPayload;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<HandoffPayload>>();

function value(record: HubSpotRecord | undefined, key: string) {
  return record?.properties[key]?.trim() ?? "";
}

function pretty(raw: string) {
  if (!raw) return "Unknown";
  return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function numeric(raw: string) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(raw: string) {
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
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

function meetingTimestamp(record: HubSpotRecord) {
  return value(record, "hs_meeting_start_time") || value(record, "hs_timestamp") || value(record, "hs_createdate");
}

function meetingEnd(record: HubSpotRecord, startAt: string) {
  const end = value(record, "hs_meeting_end_time");
  if (validDate(end)) return end;
  const start = validDate(startAt);
  return start ? new Date(start + 60 * 60 * 1000).toISOString() : startAt;
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rangeDays(from: string, to: string) {
  return Math.floor((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000) + 1;
}

function activityFilters(ownerId: string, from: string, to: string, dateProperty = "hs_timestamp"): SearchFilter[] {
  return [
    { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
    { propertyName: dateProperty, operator: "GTE", value: `${from}T00:00:00+03:00` },
    { propertyName: dateProperty, operator: "LTE", value: `${to}T23:59:59.999+03:00` },
  ];
}

function meetingKey(record: HubSpotRecord, associations: Map<string, string[]>) {
  const start = meetingTimestamp(record);
  const contactKey = [...(associations.get(record.id) ?? [])].sort().join(",");
  const minute = validDate(start) ? new Date(start).toISOString().slice(0, 16) : start;
  const title = value(record, "hs_meeting_title").toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  return `${contactKey || title || record.id}|${minute}`;
}

function dedupeMeetings(
  records: HubSpotRecord[],
  associations: Map<string, string[]>,
  maritaCreatorId: string | undefined,
): MeetingGroup[] {
  const grouped = new Map<string, HubSpotRecord[]>();
  for (const record of records) {
    const key = meetingKey(record, associations);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  return [...grouped.values()].map((group) => {
    const markerRecord = group.find((record) => value(record, "hs_internal_meeting_notes").toLowerCase().includes(MARITA_BOOKING_MARKER));
    const creatorRecord = maritaCreatorId
      ? group.find((record) => value(record, "hs_created_by_user_id") === maritaCreatorId)
      : undefined;
    const primary = markerRecord ?? creatorRecord ?? group[0];
    const startAt = meetingTimestamp(primary);
    const outcome = OUTCOME_PRIORITY.find((candidate) => group.some((record) => value(record, "hs_meeting_outcome") === candidate))
      ?? value(primary, "hs_meeting_outcome")
      ?? "UNKNOWN";
    const contactIds = [...new Set(group.flatMap((record) => associations.get(record.id) ?? []))];

    return {
      id: primary.id,
      title: value(primary, "hs_meeting_title") || "Sales meeting",
      outcome,
      startAt,
      endAt: meetingEnd(primary, startAt),
      contactIds,
      maritaCreated: Boolean(markerRecord || creatorRecord),
    };
  }).filter((meeting) => Boolean(meeting.startAt));
}

function addActivity(
  index: Map<string, ActivityEvent[]>,
  associations: Map<string, string[]>,
  record: HubSpotRecord,
  type: FollowUpType,
  at: string,
  detail: string,
) {
  if (!validDate(at)) return;
  for (const contactId of associations.get(record.id) ?? []) {
    const items = index.get(contactId) ?? [];
    items.push({ id: record.id, type, at, detail });
    index.set(contactId, items);
  }
}

function firstFollowUp(events: ActivityEvent[], after: string) {
  const cutoff = validDate(after) + 60_000;
  const candidates = events
    .filter((event) => validDate(event.at) > cutoff)
    .sort((a, b) => validDate(a.at) - validDate(b.at));
  const first = candidates[0];
  if (!first) {
    return {
      status: "No follow-up" as FollowUpStatus,
      hours: null,
      type: null,
      at: "",
      detail: "",
      lastAt: "",
    };
  }
  const hours = Math.max(0, Math.round(((validDate(first.at) - validDate(after)) / 3_600_000) * 10) / 10);
  const status: FollowUpStatus = hours <= 24 ? "Within 24h" : hours <= 48 ? "24–48h" : "48h+";
  return {
    status,
    hours,
    type: first.type,
    at: first.at,
    detail: first.detail,
    lastAt: candidates[candidates.length - 1]?.at ?? first.at,
  };
}

function chooseDeal(deals: HandoffDeal[], meetingDate: string) {
  if (!deals.length) return null;
  const meetingAt = validDate(meetingDate);
  return [...deals].sort((a, b) => {
    const aAfter = validDate(a.createdAt) >= meetingAt ? 0 : 1;
    const bAfter = validDate(b.createdAt) >= meetingAt ? 0 : 1;
    if (aAfter !== bAfter) return aAfter - bAfter;
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return validDate(b.createdAt) - validDate(a.createdAt);
  })[0];
}

function attentionFor(input: {
  meetingDate: string;
  outcome: string;
  followUpStatus: FollowUpStatus;
  lastSalesActivity: string;
  deal: HandoffDeal | null;
  nextActivity: string;
}): { level: AttentionLevel; reason: string } {
  const meetingAt = validDate(input.meetingDate);
  const now = Date.now();
  if (!meetingAt) return { level: "ok", reason: "On track" };
  if (meetingAt > now) return { level: "ok", reason: "Upcoming meeting" };

  const ageHours = (now - meetingAt) / 3_600_000;
  const ageDays = ageHours / 24;
  if (input.outcome === "NO_SHOW" && input.followUpStatus === "No follow-up" && ageHours > 24) {
    return { level: "critical", reason: "No-show · no reschedule follow-up >24h" };
  }
  if (input.outcome === "COMPLETED" && input.followUpStatus === "No follow-up" && ageHours > 24) {
    return { level: "critical", reason: "Completed meeting · no sales follow-up >24h" };
  }
  if (!input.deal && input.followUpStatus === "No follow-up" && ageDays > 7) {
    return { level: "critical", reason: "No follow-up and no deal >7d" };
  }
  if (input.deal?.isOpen && !input.nextActivity) {
    return { level: "warning", reason: "Open deal · no next activity" };
  }
  if (input.deal?.isOpen && input.lastSalesActivity && now - validDate(input.lastSalesActivity) > 7 * 86_400_000) {
    return { level: "warning", reason: "Open deal · no sales activity >7d" };
  }
  if (!input.deal && ageDays > 7 && input.outcome === "COMPLETED") {
    return { level: "warning", reason: "Completed meeting · no associated deal >7d" };
  }
  return { level: "ok", reason: "On track" };
}

function cacheKey(from: string, to: string, salesRepId: string) {
  return `${from}:${to}:${salesRepId}`;
}

function pruneCache() {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) return;
    cache.delete(oldestKey);
  }
}

async function buildHandoff(from: string, to: string, salesRepId: string): Promise<HandoffPayload> {
  const today = new Date().toISOString().slice(0, 10);
  const followUpTo = addDays(to, FOLLOW_UP_DAYS) < today ? addDays(to, FOLLOW_UP_DAYS) : today;

  const [owners, stageLabels, meetingsRaw, callsRaw, emailsRaw, communicationsRaw] = await Promise.all([
    listOwners(),
    listDealStages(),
    searchAll("meetings", HANDOFF_MEETING_PROPERTIES, activityFilters(salesRepId, from, followUpTo), ["hs_timestamp"]),
    searchAll("calls", CALL_PROPERTIES, activityFilters(salesRepId, from, followUpTo), ["hs_timestamp"]),
    searchAll("emails", EMAIL_PROPERTIES, activityFilters(salesRepId, from, followUpTo), ["hs_timestamp"]),
    searchAll("communications", COMMUNICATION_PROPERTIES, [
      ...activityFilters(salesRepId, from, followUpTo),
      { propertyName: "hs_communication_channel_type", operator: "EQ", value: "WHATS_APP" },
    ], ["hs_timestamp"]),
  ]);

  const maritaCreatorId = meetingCreatorId(owners, SDR_OWNERS.marita.ownerId);
  const [meetingContacts, callContacts, emailContacts, communicationContacts] = await Promise.all([
    readAssociations("meetings", "contacts", meetingsRaw.map((record) => record.id)),
    readAssociations("calls", "contacts", callsRaw.map((record) => record.id)),
    readAssociations("emails", "contacts", emailsRaw.map((record) => record.id)),
    readAssociations("communications", "contacts", communicationsRaw.map((record) => record.id)),
  ]);

  const allMeetingGroups = dedupeMeetings(meetingsRaw, meetingContacts, maritaCreatorId);
  const cohort = allMeetingGroups
    .filter((meeting) => meeting.maritaCreated && localDay(meeting.startAt) >= from && localDay(meeting.startAt) <= to)
    .sort((a, b) => validDate(b.startAt) - validDate(a.startAt));

  const contactIds = [...new Set(cohort.flatMap((meeting) => meeting.contactIds))];
  const [contacts, contactDeals] = await Promise.all([
    batchRead("contacts", contactIds, HANDOFF_CONTACT_PROPERTIES),
    readAssociations("contacts", "deals", contactIds),
  ]);
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const dealIds = [...new Set([...contactDeals.values()].flat())];

  const companyIds = [...new Set(contacts.map((contact) => value(contact, "company_id")).filter(Boolean))];
  const [dealRecords, companies] = await Promise.all([
    batchRead("deals", dealIds, DEAL_PROPERTIES),
    batchRead("companies", companyIds, HANDOFF_COMPANY_PROPERTIES),
  ]);
  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const ownerMap = new Map(owners.map((owner) => [owner.id, owner.name]));

  const dealMap = new Map<string, HandoffDeal>();
  for (const deal of dealRecords) {
    dealMap.set(deal.id, {
      id: deal.id,
      name: value(deal, "dealname") || `Deal #${deal.id}`,
      stage: stageLabels.get(value(deal, "dealstage")) ?? pretty(value(deal, "dealstage")),
      owner: ownerMap.get(value(deal, "hubspot_owner_id")) ?? "Unassigned",
      amount: numeric(value(deal, "amount_in_home_currency") || value(deal, "amount") || value(deal, "sar_amount")),
      createdAt: value(deal, "createdate"),
      closeDate: value(deal, "closedate"),
      nextActivity: value(deal, "notes_next_activity_date"),
      isOpen: value(deal, "hs_is_closed") !== "true",
      isClosedWon: value(deal, "hs_is_closed_won") === "true",
      url: hubspotRecordUrl("deal", deal.id),
    });
  }

  const activityIndex = new Map<string, ActivityEvent[]>();
  for (const call of callsRaw) {
    addActivity(
      activityIndex,
      callContacts,
      call,
      "Call",
      value(call, "hs_timestamp"),
      value(call, "hs_call_title") || "Sales call",
    );
  }
  for (const email of emailsRaw) {
    const direction = value(email, "hs_email_direction");
    if (!(direction.includes("OUTGOING") || direction === "EMAIL")) continue;
    addActivity(
      activityIndex,
      emailContacts,
      email,
      "Email",
      value(email, "hs_timestamp"),
      value(email, "hs_email_subject") || "Sales email",
    );
  }
  for (const communication of communicationsRaw) {
    addActivity(
      activityIndex,
      communicationContacts,
      communication,
      "WhatsApp",
      value(communication, "hs_timestamp"),
      (value(communication, "hs_communication_body") || "WhatsApp follow-up").replace(/\s+/g, " ").slice(0, 140),
    );
  }
  for (const meeting of allMeetingGroups) {
    for (const contactId of meeting.contactIds) {
      const items = activityIndex.get(contactId) ?? [];
      items.push({ id: meeting.id, type: "Meeting", at: meeting.startAt, detail: meeting.title });
      activityIndex.set(contactId, items);
    }
  }

  for (const items of activityIndex.values()) {
    items.sort((a, b) => validDate(a.at) - validDate(b.at));
  }

  const rows: HandoffRow[] = cohort.map((meeting) => {
    const meetingContactsRecords = meeting.contactIds.map((contactId) => contactMap.get(contactId)).filter(Boolean) as HubSpotRecord[];
    const contactsForRow = meetingContactsRecords.map((contact) => ({
      id: contact.id,
      name: [value(contact, "firstname"), value(contact, "lastname")].filter(Boolean).join(" ") || value(contact, "email") || `Contact #${contact.id}`,
      email: value(contact, "email"),
      phone: value(contact, "mobilephone") || value(contact, "phone"),
      url: hubspotRecordUrl("contact", contact.id),
    }));

    const companyId = meetingContactsRecords.map((contact) => value(contact, "company_id")).find(Boolean) || "";
    const companyRecord = companyMap.get(companyId);
    const companyName = value(companyRecord, "name") || meetingContactsRecords.map((contact) => value(contact, "company")).find(Boolean) || "Unknown company";
    const company = companyId ? {
      id: companyId,
      name: companyName,
      domain: value(companyRecord, "domain"),
      url: hubspotRecordUrl("company", companyId),
    } : null;

    const events = [...new Map(
      meeting.contactIds
        .flatMap((contactId) => activityIndex.get(contactId) ?? [])
        .map((event) => [`${event.type}:${event.id}`, event]),
    ).values()];
    const followUp = firstFollowUp(events, meeting.endAt);

    const associatedDeals = [...new Set(
      meeting.contactIds.flatMap((contactId) => contactDeals.get(contactId) ?? []),
    )].map((dealId) => dealMap.get(dealId)).filter(Boolean) as HandoffDeal[];
    const deal = chooseDeal(associatedDeals, meeting.startAt);
    const dealCreatedAfterMeeting = Boolean(deal && validDate(deal.createdAt) >= validDate(meeting.startAt));
    const nextActivity = deal?.nextActivity
      || meetingContactsRecords.map((contact) => value(contact, "notes_next_activity_date")).filter(Boolean).sort()[0]
      || "";
    const lastSalesActivity = followUp.lastAt;
    const attention = attentionFor({
      meetingDate: meeting.startAt,
      outcome: meeting.outcome,
      followUpStatus: followUp.status,
      lastSalesActivity,
      deal,
      nextActivity,
    });

    return {
      id: meeting.id,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDate: meeting.startAt,
      meetingEnd: meeting.endAt,
      outcome: meeting.outcome,
      contacts: contactsForRow,
      company,
      followUp: {
        status: followUp.status,
        hours: followUp.hours,
        type: followUp.type,
        at: followUp.at,
        detail: followUp.detail,
      },
      lastSalesActivity,
      nextActivity,
      deal,
      dealCreatedAfterMeeting,
      attention,
      recordUrl: contactsForRow[0]?.url || company?.url || (deal?.url ?? ""),
    };
  });

  const uniqueDeals = [...new Map(rows.flatMap((row) => row.deal ? [[row.deal.id, row.deal] as const] : [])).values()];
  const followedUp = rows.filter((row) => row.followUp.status !== "No follow-up").length;
  const salesRep = owners.find((owner) => owner.id === salesRepId);
  const salesReps = SALES_REP_OWNER_IDS
    .map((id) => ({ id, name: ownerMap.get(id) ?? (id === DEFAULT_SALES_REP_ID ? "Ursula Waked" : id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      from,
      to,
      timezone: HUBSPOT_TIMEZONE,
      sdr: { id: SDR_OWNERS.marita.ownerId, name: SDR_OWNERS.marita.name },
      salesRep: { id: salesRepId, name: salesRep?.name ?? (salesRepId === DEFAULT_SALES_REP_ID ? "Ursula Waked" : salesRepId) },
      salesReps,
      followUpDays: FOLLOW_UP_DAYS,
      cache: "miss",
    },
    kpis: {
      meetings: rows.length,
      completed: rows.filter((row) => row.outcome === "COMPLETED").length,
      followedUp,
      followUpRate: rows.length ? Math.round((followedUp / rows.length) * 1000) / 10 : 0,
      deals: uniqueDeals.length,
      openDeals: uniqueDeals.filter((deal) => deal.isOpen).length,
      closedWon: uniqueDeals.filter((deal) => deal.isClosedWon).length,
      pipelineValue: uniqueDeals.filter((deal) => deal.isOpen).reduce((sum, deal) => sum + deal.amount, 0),
      needsAttention: rows.filter((row) => row.attention.level !== "ok").length,
    },
    rows,
  };
}

async function getPayload(from: string, to: string, salesRepId: string, force: boolean) {
  const key = cacheKey(from, to, salesRepId);
  const now = Date.now();
  const cached = cache.get(key);
  if (!force && cached && cached.expiresAt > now) {
    return {
      ...cached.payload,
      meta: { ...cached.payload.meta, cache: "hit" as const },
    };
  }

  if (!force) {
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const promise = buildHandoff(from, to, salesRepId)
    .then((payload) => {
      cache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
      pruneCache();
      return payload;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function monthStart() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    from: params.get("from") ?? monthStart(),
    to: params.get("to") ?? new Date().toISOString().slice(0, 10),
    salesRepId: params.get("salesRepId") ?? DEFAULT_SALES_REP_ID,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sales handoff filters", details: parsed.error.flatten() }, { status: 400 });
  }
  const { from, to, salesRepId } = parsed.data;
  if (from > to) return NextResponse.json({ error: "The start date must be before the end date" }, { status: 400 });
  if (rangeDays(from, to) > MAX_REPORT_DAYS) {
    return NextResponse.json({ error: `Choose a reporting range of ${MAX_REPORT_DAYS} days or less` }, { status: 400 });
  }
  if (!SALES_REP_OWNER_IDS.includes(salesRepId as (typeof SALES_REP_OWNER_IDS)[number])) {
    return NextResponse.json({ error: "Choose a configured Talentera Sales Rep" }, { status: 400 });
  }

  try {
    const payload = await getPayload(from, to, salesRepId, params.get("refresh") === "1");
    return compressedJsonResponse(request, payload, {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      "X-Sales-Handoff-Cache": payload.meta.cache,
      "X-Sales-Handoff-Rows": String(payload.rows.length),
      "Vary": "Accept-Encoding",
    });
  } catch (error) {
    console.error("Sales handoff dashboard failed", error);
    return NextResponse.json({
      error: "Unable to load Sales Handoff data",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
