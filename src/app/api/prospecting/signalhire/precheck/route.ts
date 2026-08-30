import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { batchRead, HubSpotApiError, readAssociations, searchAll } from "@/lib/hubspot";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONNECTED_CALL_DISPOSITIONS = new Set([
  "f240bbac-87c9-4f6e-bf70-924b57d47db7", // Connected
  "2e7360c1-6b71-40e9-ab2b-30ae98a4678c", // Meeting booked
]);
const MEANINGFUL_MEETING_OUTCOMES = new Set(["SCHEDULED", "COMPLETED", "RESCHEDULED"]);
const MAX_CONTACTS_PER_COMPANY_SCAN = 100;
const ENGAGEMENT_CACHE_TTL_MS = 5 * 60 * 1000;

const schema = z.object({
  name: z.string().trim().max(220).default(""),
  company: z.string().trim().max(320).default(""),
  companyWebsite: z.string().trim().max(1500).default(""),
  companyDomain: z.string().trim().max(320).default(""),
  linkedinUrl: z.string().trim().max(1500).default(""),
  email: z.string().trim().max(320).default(""),
  emails: z.array(z.string().trim().max(320)).max(20).default([]),
  phone: z.string().trim().max(120).default(""),
  phones: z.array(z.string().trim().max(120)).max(20).default([]),
});

type EngagementCheck = {
  checked: boolean;
  engaged: boolean;
  connectedCallCount: number;
  meetingCount: number;
  latestConnectedCallAt: string;
  latestMeetingAt: string;
  latestEngagementAt: string;
  reason: string;
  error: string;
};

type EngagementCacheEntry = {
  expiresAt: number;
  value?: EngagementCheck;
  inflight?: Promise<EngagementCheck>;
};

const engagementCache = new Map<string, EngagementCacheEntry>();

function emptyEngagement(checked = true, error = ""): EngagementCheck {
  return {
    checked,
    engaged: false,
    connectedCallCount: 0,
    meetingCount: 0,
    latestConnectedCallAt: "",
    latestMeetingAt: "",
    latestEngagementAt: "",
    reason: "",
    error,
  };
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workDomain(emails: string[]) {
  const blocked = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|protonmail|proton)\./i;
  for (const email of emails) {
    const domain = email.split("@")[1]?.toLowerCase().trim() || "";
    if (domain && !blocked.test(domain)) return normalizeCompanyDomain(domain);
  }
  return "";
}

function latestIso(values: Array<string | undefined>) {
  let latest = 0;
  for (const value of values) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(parsed)) latest = Math.max(latest, parsed);
  }
  return latest ? new Date(latest).toISOString() : "";
}

async function safeAssociations(fromObjectType: string, toObjectType: string, fromIds: string[]) {
  if (!fromIds.length) return new Map<string, string[]>();
  try {
    return await readAssociations(fromObjectType, toObjectType, fromIds);
  } catch (error) {
    if (error instanceof HubSpotApiError && [400, 404].includes(error.status)) return new Map<string, string[]>();
    throw error;
  }
}

async function scanCompanyEngagement(companyId: string): Promise<EngagementCheck> {
  try {
    const [companyContacts, companyCalls, companyMeetings] = await Promise.all([
      safeAssociations("companies", "contacts", [companyId]),
      safeAssociations("companies", "calls", [companyId]),
      safeAssociations("companies", "meetings", [companyId]),
    ]);

    const allContactIds = companyContacts.get(companyId) || [];
    const contactIds = allContactIds.slice(0, MAX_CONTACTS_PER_COMPANY_SCAN);
    const [contactCalls, contactMeetings] = await Promise.all([
      safeAssociations("contacts", "calls", contactIds),
      safeAssociations("contacts", "meetings", contactIds),
    ]);

    const callIds = new Set(companyCalls.get(companyId) || []);
    const meetingIds = new Set(companyMeetings.get(companyId) || []);
    for (const ids of contactCalls.values()) for (const id of ids) callIds.add(id);
    for (const ids of contactMeetings.values()) for (const id of ids) meetingIds.add(id);

    const [calls, meetings] = await Promise.all([
      batchRead("calls", [...callIds], ["hs_call_disposition", "hs_call_status", "hs_timestamp"]),
      batchRead("meetings", [...meetingIds], ["hs_meeting_outcome", "hs_meeting_title", "hs_meeting_start_time", "hs_timestamp"]),
    ]);

    const connectedCalls = calls.filter((call) => CONNECTED_CALL_DISPOSITIONS.has(String(call.properties.hs_call_disposition || "")));
    const meaningfulMeetings = meetings.filter((meeting) => MEANINGFUL_MEETING_OUTCOMES.has(String(meeting.properties.hs_meeting_outcome || "").toUpperCase()));
    const latestConnectedCallAt = latestIso(connectedCalls.map((call) => String(call.properties.hs_timestamp || "")));
    const latestMeetingAt = latestIso(meaningfulMeetings.map((meeting) => String(meeting.properties.hs_meeting_start_time || meeting.properties.hs_timestamp || "")));
    const latestEngagementAt = latestIso([latestConnectedCallAt, latestMeetingAt]);
    const engaged = connectedCalls.length > 0 || meaningfulMeetings.length > 0;

    const reasonParts: string[] = [];
    if (connectedCalls.length) reasonParts.push(`${connectedCalls.length} connected call${connectedCalls.length === 1 ? "" : "s"}`);
    if (meaningfulMeetings.length) reasonParts.push(`${meaningfulMeetings.length} meeting${meaningfulMeetings.length === 1 ? "" : "s"}`);

    if (!engaged && allContactIds.length > MAX_CONTACTS_PER_COMPANY_SCAN) {
      return {
        ...emptyEngagement(false, `Company has ${allContactIds.length} HubSpot contacts; automatic engagement scan is capped at ${MAX_CONTACTS_PER_COMPANY_SCAN}. Review before Push.`),
        reason: `Engagement scan incomplete (${MAX_CONTACTS_PER_COMPANY_SCAN}/${allContactIds.length} contacts checked)`,
      };
    }

    return {
      checked: true,
      engaged,
      connectedCallCount: connectedCalls.length,
      meetingCount: meaningfulMeetings.length,
      latestConnectedCallAt,
      latestMeetingAt,
      latestEngagementAt,
      reason: reasonParts.join(" · "),
      error: "",
    };
  } catch (error) {
    console.error("SignalHire company engagement scan failed", { companyId, error });
    return emptyEngagement(false, error instanceof Error
      ? `Could not verify company calls/meetings: ${error.message}`
      : "Could not verify company calls/meetings.");
  }
}

async function companyEngagementCheck(companyId: string): Promise<EngagementCheck> {
  const now = Date.now();
  const cached = engagementCache.get(companyId);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.inflight) return cached.inflight;

  const inflight = scanCompanyEngagement(companyId)
    .then((value) => {
      engagementCache.set(companyId, { value, expiresAt: Date.now() + ENGAGEMENT_CACHE_TTL_MS });
      return value;
    })
    .catch((error) => {
      engagementCache.delete(companyId);
      return emptyEngagement(false, error instanceof Error ? error.message : "Company engagement scan failed.");
    });

  engagementCache.set(companyId, { expiresAt: 0, inflight });
  return inflight;
}

async function contactCheck(input: z.infer<typeof schema>) {
  const emails = unique([input.email, ...input.emails]);
  const phones = unique([input.phone, ...input.phones]);
  const props = ["firstname", "lastname", "email", "phone", "mobilephone", "company", "jobtitle", "hubspot_owner_id"];

  for (const email of emails.slice(0, 5)) {
    const matches = await searchAll("contacts", props, [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }]);
    if (matches[0]) return { inHubSpot: true, id: String(matches[0].id), matchedBy: "email", properties: matches[0].properties };
  }

  if (input.linkedinUrl) {
    try {
      const matches = await searchAll("contacts", [...props, "gtm_linkedin_url"], [{ propertyName: "gtm_linkedin_url", operator: "EQ", value: input.linkedinUrl }]);
      if (matches[0]) return { inHubSpot: true, id: String(matches[0].id), matchedBy: "linkedin", properties: matches[0].properties };
    } catch (error) {
      if (!(error instanceof HubSpotApiError) || ![400, 404].includes(error.status)) throw error;
    }
  }

  for (const phone of phones.slice(0, 3)) {
    const matches = await searchAll("contacts", props, [{ propertyName: "phone", operator: "EQ", value: phone }]);
    if (matches[0]) return { inHubSpot: true, id: String(matches[0].id), matchedBy: "phone", properties: matches[0].properties };
    const mobile = await searchAll("contacts", props, [{ propertyName: "mobilephone", operator: "EQ", value: phone }]);
    if (mobile[0]) return { inHubSpot: true, id: String(mobile[0].id), matchedBy: "mobilephone", properties: mobile[0].properties };
  }

  return { inHubSpot: false, id: "", matchedBy: "", properties: {} as Record<string, unknown> };
}

async function companyCheck(input: z.infer<typeof schema>, shouldCheckEngagement: boolean) {
  const properties = [
    "name", "domain", "account_type", "account_status", "hs_num_open_deals", "search_status",
    "detected_ats", "ats_status", "career_page_url", "hs_lead_status", "hubspot_owner_id",
  ];
  const domain = normalizeCompanyDomain(input.companyDomain || input.companyWebsite)
    || workDomain(unique([input.email, ...input.emails]));
  let match = null as Awaited<ReturnType<typeof searchAll>>[number] | null;
  let matchedBy = "";

  if (domain) {
    const matches = await searchAll("companies", properties, [{ propertyName: "domain", operator: "EQ", value: domain }]);
    if (matches[0]) { match = matches[0]; matchedBy = "domain"; }
  }

  if (!match && input.company) {
    const matches = await searchAll("companies", properties, [{ propertyName: "name", operator: "EQ", value: input.company }]);
    if (matches[0]) { match = matches[0]; matchedBy = "name"; }
  }

  if (!match) {
    return {
      inHubSpot: false, id: "", matchedBy: "", name: input.company, domain,
      accountType: "", accountStatus: "", openDeals: 0, searchStatus: "", detectedAts: "", atsStatus: "", careerPageUrl: "", leadStatus: "", ownerId: "",
      engagementChecked: true, engagementError: "", engaged: false, connectedCallCount: 0, meetingCount: 0, latestConnectedCallAt: "", latestMeetingAt: "", latestEngagementAt: "", engagementReason: "",
      protected: false, protectedReason: "",
    };
  }

  const p = match.properties;
  const accountType = String(p.account_type || "").trim();
  const accountStatus = String(p.account_status || "").trim();
  const openDeals = Math.max(0, Number(p.hs_num_open_deals || 0) || 0);
  const retentionAccount = accountType.toLowerCase() === "retention";
  const protectedCompany = Boolean(retentionAccount || openDeals > 0);
  const engagement = shouldCheckEngagement && !protectedCompany
    ? await companyEngagementCheck(String(match.id))
    : emptyEngagement(false);
  const protectedReason = retentionAccount
    ? `Retention account${accountStatus ? ` · ${accountStatus}` : ""}`
    : openDeals > 0
      ? `${openDeals} open deal${openDeals === 1 ? "" : "s"}`
      : "";

  return {
    inHubSpot: true,
    id: String(match.id),
    matchedBy,
    name: String(p.name || input.company || ""),
    domain: String(p.domain || domain || ""),
    accountType,
    accountStatus,
    openDeals,
    searchStatus: String(p.search_status || ""),
    detectedAts: String(p.detected_ats || ""),
    atsStatus: String(p.ats_status || ""),
    careerPageUrl: String(p.career_page_url || ""),
    leadStatus: String(p.hs_lead_status || ""),
    ownerId: String(p.hubspot_owner_id || ""),
    engagementChecked: engagement.checked,
    engagementError: engagement.error,
    engaged: engagement.engaged,
    connectedCallCount: engagement.connectedCallCount,
    meetingCount: engagement.meetingCount,
    latestConnectedCallAt: engagement.latestConnectedCallAt,
    latestMeetingAt: engagement.latestMeetingAt,
    latestEngagementAt: engagement.latestEngagementAt,
    engagementReason: engagement.reason,
    protected: protectedCompany,
    protectedReason,
  };
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid SignalHire precheck payload." }, { status: 400 });

    // Contact existence is the cheapest decisive guard. Do it first so existing people
    // never trigger an expensive company-wide calls/meetings scan.
    const contact = await contactCheck(parsed.data);
    const company = await companyCheck(parsed.data, !contact.inHubSpot);

    return NextResponse.json({ contact, company, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SignalHire HubSpot precheck failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "HubSpot precheck failed." }, { status: 500 });
  }
}
