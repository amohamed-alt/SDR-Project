import fs from "node:fs/promises";
import path from "node:path";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { getMaritaPriorityQueue, type MaritaPriorityCompany } from "@/lib/marita-priority";
import { openRouterCompletion } from "@/lib/openrouter-low-cost";
import { SALES_REP_OWNER_IDS } from "@/lib/sales-reps";
import {
  calculateCoverage,
  emailStatusIsSafe,
  industryBucket,
  isValidBusinessEmail,
  localeForCountry,
  personaBucket,
  renderOutreachTemplate,
  sanitizeOutreachText,
  type OutreachLocale,
} from "@/lib/smartlead-policy";
import type { HubSpotRecord } from "@/lib/types";

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
const MARITA_OWNER_ID = "31644369";
const CACHE_TTL_MS = 2 * 60 * 1000;
const PREPARED_PATH = process.env.SMARTLEAD_PREPARED_PATH || "/app/data/smartlead-prepared.json";
const CAMPAIGN_NAME = process.env.SMARTLEAD_CAMPAIGN_NAME || "Talentera | Marita SDR | Localized 3-Touch";

const CONTACT_PROPERTIES = [
  "firstname", "lastname", "email", "jobtitle", "country", "gtm_email_status", "gtm_persona", "gtm_linkedin_url",
] as const;
const COMPANY_PROPERTIES = [
  "name", "domain", "country", "gtm_country", "industry", "gtm_industry", "detected_ats", "ats_status", "career_page_url",
] as const;
const SALES_ACTIVITY_PROPERTIES: Record<SalesActivityType, readonly string[]> = {
  emails: ["hs_timestamp", "hubspot_owner_id", "hs_email_direction", "hs_email_status"],
  meetings: ["hs_timestamp", "hs_meeting_start_time", "hubspot_owner_id", "hs_meeting_outcome"],
  communications: ["hs_timestamp", "hubspot_owner_id", "hs_communication_channel_type", "hs_communication_logged_from"],
};

type JsonObject = Record<string, unknown>;
type SalesActivityType = "emails" | "meetings" | "communications";

type SmartleadCampaign = {
  id: number;
  name: string;
  status: string;
  maxLeadsPerDay: number;
  timezone: string;
};

export type SmartleadSender = {
  id: number;
  email: string;
  fromName: string;
  maxPerDay: number;
  warmupEnabled: boolean;
  assigned: boolean;
};

export type SmartleadQueueLead = {
  contactId: string;
  companyId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  title: string;
  companyName: string;
  domain: string;
  country: string;
  industry: string;
  industryBucket: string;
  persona: string;
  locale: OutreachLocale;
  detectedAts: string;
  atsAngle: "replace" | "modernize" | "consolidate";
  linkedinUrl: string;
  priority: string;
  priorityScore: number;
  eligible: boolean;
  blockReason: string;
};

export type PreparedSmartleadLead = SmartleadQueueLead & {
  subject1: string;
  touch1: string;
  subject2: string;
  touch2: string;
  subject3: string;
  touch3: string;
};

type PreparedBatch = {
  version: 1;
  createdAt: string;
  sourceGeneratedAt: string;
  campaignName: string;
  leads: PreparedSmartleadLead[];
  launchedAt?: string;
};

type SequenceTemplate = {
  subject1: string;
  touch1: string;
  subject2: string;
  touch2: string;
  subject3: string;
  touch3: string;
};

type SalesSafety = {
  healthy: boolean;
  blockedContactIds: Set<string>;
  blockedCompanyIds: Set<string>;
  activityCount: number;
  warnings: string[];
};

export type SmartleadCommandCenterPayload = {
  generatedAt: string;
  configuration: {
    apiConfigured: boolean;
    openRouterConfigured: boolean;
    ownerActionsConfigured: boolean;
    maritaOwnerId: string;
    campaignName: string;
    salesLookbackDays: number;
  };
  safety: {
    healthy: boolean;
    recentSalesActivities: number;
    blockedContacts: number;
    blockedCompanies: number;
    warnings: string[];
  };
  campaign: SmartleadCampaign | null;
  analytics: {
    sent: number;
    replies: number;
    bounces: number;
    unsubscribed: number;
    activeLeads: number;
  };
  senders: SmartleadSender[];
  summary: {
    maritaCompanies: number;
    emailCandidates: number;
    ready: number;
    blockedBySales: number;
    blockedEmail: number;
    alreadyInCampaign: number;
    prepared: number;
    dailyNewCap: number;
    today: number;
    tomorrow: number;
    next48Hours: number;
    coverageDays: number;
  };
  queue: SmartleadQueueLead[];
  preparedSamples: PreparedSmartleadLead[];
};

type CacheEntry = { expiresAt: number; payload: SmartleadCommandCenterPayload };
let cache: CacheEntry | null = null;

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function text(record: HubSpotRecord | undefined, key: string) {
  return clean(record?.properties?.[key]);
}

function positiveInt(value: unknown, fallback: number, min = 1, max = 10_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function dailyNewCap() {
  return positiveInt(process.env.SMARTLEAD_DAILY_NEW_LEADS, 75, 1, 500);
}

function salesLookbackDays() {
  return positiveInt(process.env.SMARTLEAD_SALES_ACTIVITY_LOOKBACK_DAYS, 45, 1, 365);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function list(value: unknown, keys: string[] = []) {
  if (Array.isArray(value)) return value;
  const item = object(value);
  for (const key of keys) {
    if (Array.isArray(item[key])) return item[key] as unknown[];
  }
  return [] as unknown[];
}

function numberFrom(value: unknown, keys: string[]) {
  const item = object(value);
  for (const key of keys) {
    const parsed = Number(item[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getSmartleadApiKey() {
  return clean(process.env.SMARTLEAD_API_KEY, 2_000);
}

async function smartleadRequest<T>(endpoint: string, init: RequestInit = {}, extraQuery: Record<string, string> = {}): Promise<T> {
  const apiKey = getSmartleadApiKey();
  if (!apiKey) throw new Error("SMARTLEAD_API_KEY is not configured on the production server.");
  const query = new URLSearchParams({ api_key: apiKey, ...extraQuery });
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${SMARTLEAD_API}${endpoint}?${query.toString()}`, {
        ...init,
        headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
      }
      const body = (await response.text()).slice(0, 800);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
        continue;
      }
      throw new Error(`Smartlead API request failed (${response.status}): ${body}`);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Smartlead API request failed.");
}

function parseCampaign(value: unknown): SmartleadCampaign | null {
  const item = object(value);
  const id = Number(item.id);
  if (!Number.isFinite(id)) return null;
  const cron = object(item.scheduler_cron_value);
  return {
    id,
    name: clean(item.name) || `Campaign ${id}`,
    status: clean(item.status) || "UNKNOWN",
    maxLeadsPerDay: numberFrom(item, ["max_leads_per_day", "maxLeadsPerDay"]),
    timezone: clean(cron.tz || item.timezone),
  };
}

async function listCampaigns() {
  const payload = await smartleadRequest<unknown>("/campaigns/", { method: "GET" }, { include_tags: "true" });
  return list(payload, ["campaigns", "data"]).map(parseCampaign).filter((item): item is SmartleadCampaign => Boolean(item));
}

async function resolveCampaign() {
  if (!getSmartleadApiKey()) return null;
  const configuredId = Number(process.env.SMARTLEAD_CAMPAIGN_ID);
  if (Number.isFinite(configuredId) && configuredId > 0) {
    const payload = await smartleadRequest<unknown>(`/campaigns/${configuredId}`, { method: "GET" });
    return parseCampaign(payload);
  }
  const campaigns = await listCampaigns();
  return campaigns.find((campaign) => campaign.name === CAMPAIGN_NAME) ?? null;
}

function parseSender(value: unknown, assignedIds: Set<number>): SmartleadSender | null {
  const item = object(value);
  const id = Number(item.id ?? item.email_account_id);
  if (!Number.isFinite(id)) return null;
  const warmup = object(item.warmup_details || item.warmup);
  return {
    id,
    email: clean(item.from_email || item.email || item.username),
    fromName: clean(item.from_name || item.name),
    maxPerDay: numberFrom(item, ["max_email_per_day", "daily_limit", "max_emails_per_day"]),
    warmupEnabled: Boolean(item.warmup_enabled ?? warmup.enabled ?? warmup.warmup_enabled),
    assigned: assignedIds.has(id),
  };
}

async function listAllEmailAccounts() {
  const accounts: unknown[] = [];
  for (let offset = 0; offset < 5_000; offset += 100) {
    const payload = await smartleadRequest<unknown>("/email-accounts/", { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(payload, ["email_accounts", "data", "accounts"]);
    accounts.push(...batch);
    if (batch.length < 100) break;
  }
  return accounts;
}

async function campaignAssignedSenderIds(campaign: SmartleadCampaign | null) {
  if (!campaign) return new Set<number>();
  const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/email-accounts`, { method: "GET" });
  return new Set(list(payload, ["email_accounts", "data", "accounts"])
    .map((value) => Number(object(value).id ?? object(value).email_account_id))
    .filter((value) => Number.isFinite(value)));
}

async function smartleadSenders(campaign: SmartleadCampaign | null) {
  if (!getSmartleadApiKey()) return [] as SmartleadSender[];
  const [raw, assignedIds] = await Promise.all([listAllEmailAccounts(), campaignAssignedSenderIds(campaign)]);
  return raw.map((item) => parseSender(item, assignedIds)).filter((item): item is SmartleadSender => Boolean(item));
}

async function campaignLeadRows(campaign: SmartleadCampaign | null) {
  if (!campaign) return [] as JsonObject[];
  const rows: JsonObject[] = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/leads`, { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(payload, ["leads", "data", "results"]).map(object);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

async function campaignAnalytics(campaign: SmartleadCampaign | null, leads: JsonObject[]) {
  if (!campaign) return { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0 };
  const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/analytics`, { method: "GET" }).catch(() => ({}));
  return {
    sent: numberFrom(payload, ["sent_count", "sent", "total_sent", "emails_sent"]),
    replies: numberFrom(payload, ["reply_count", "replies", "total_replies"]),
    bounces: numberFrom(payload, ["bounce_count", "bounces", "total_bounces"]),
    unsubscribed: numberFrom(payload, ["unsubscribe_count", "unsubscribed", "total_unsubscribed"]),
    activeLeads: leads.filter((lead) => !Boolean(lead.is_unsubscribed) && !/(?:completed|stopped|paused)/i.test(clean(lead.status))).length,
  };
}

async function scanSalesActivities(type: SalesActivityType, cutoff: string) {
  try {
    const activities = await searchAll(type, SALES_ACTIVITY_PROPERTIES[type], [
      { propertyName: "hubspot_owner_id", operator: "IN", values: [...SALES_REP_OWNER_IDS] },
      { propertyName: "hs_timestamp", operator: "GTE", value: cutoff },
    ]);
    const ids = activities.map((activity) => activity.id);
    const [contacts, companies] = await Promise.all([
      readAssociations(type, "contacts", ids),
      readAssociations(type, "companies", ids),
    ]);
    return { type, activities, contacts, companies, error: "" };
  } catch (error) {
    return {
      type,
      activities: [] as HubSpotRecord[],
      contacts: new Map<string, string[]>(),
      companies: new Map<string, string[]>(),
      error: error instanceof Error ? error.message : "Unknown HubSpot activity error",
    };
  }
}

async function recentSalesSafety(): Promise<SalesSafety> {
  const cutoff = String(Date.now() - salesLookbackDays() * 86_400_000);
  const scans = await Promise.all((Object.keys(SALES_ACTIVITY_PROPERTIES) as SalesActivityType[]).map((type) => scanSalesActivities(type, cutoff)));
  const warnings = scans.filter((scan) => scan.error).map((scan) => `${scan.type}: ${scan.error}`);
  const blockedContactIds = new Set<string>();
  const blockedCompanyIds = new Set<string>();
  const salesContactIds = new Set<string>();
  let activityCount = 0;

  for (const scan of scans) {
    activityCount += scan.activities.length;
    for (const activity of scan.activities) {
      for (const contactId of scan.contacts.get(activity.id) ?? []) {
        blockedContactIds.add(contactId);
        salesContactIds.add(contactId);
      }
      for (const companyId of scan.companies.get(activity.id) ?? []) blockedCompanyIds.add(companyId);
    }
  }

  if (salesContactIds.size) {
    try {
      const contactCompanies = await readAssociations("contacts", "companies", [...salesContactIds]);
      for (const companyIds of contactCompanies.values()) {
        for (const companyId of companyIds) blockedCompanyIds.add(companyId);
      }
    } catch (error) {
      warnings.push(`contact-company sales safety: ${error instanceof Error ? error.message : "Unknown association error"}`);
    }
  }

  return { healthy: warnings.length === 0, blockedContactIds, blockedCompanyIds, activityCount, warnings };
}

function bestEmailContact(company: MaritaPriorityCompany) {
  return company.contacts.find((contact) => isValidBusinessEmail(contact.email)) ?? null;
}

function atsAngle(ats: string): SmartleadQueueLead["atsAngle"] {
  if (!clean(ats) || /unknown|not detected|none|custom/i.test(clean(ats))) return "consolidate";
  if (/taleo|successfactors|workday|oracle|sap/i.test(clean(ats))) return "modernize";
  return "replace";
}

function splitName(record: HubSpotRecord | undefined, fallback: string) {
  const firstName = text(record, "firstname");
  const lastName = text(record, "lastname");
  if (firstName || lastName) return { firstName, lastName };
  const parts = clean(fallback).split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

async function readPreparedBatch(): Promise<PreparedBatch | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(PREPARED_PATH, "utf8")) as PreparedBatch;
    if (parsed?.version !== 1 || !Array.isArray(parsed.leads)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writePreparedBatch(batch: PreparedBatch) {
  await fs.mkdir(path.dirname(PREPARED_PATH), { recursive: true });
  const temp = `${PREPARED_PATH}.tmp-${process.pid}`;
  await fs.writeFile(temp, JSON.stringify(batch), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, PREPARED_PATH);
}

async function buildQueue(forceRefresh: boolean) {
  const priority = await getMaritaPriorityQueue(forceRefresh);
  if (priority.ownerId !== MARITA_OWNER_ID) throw new Error("Marita owner safety boundary failed.");

  const companyIds = unique(priority.companies.map((company) => company.companyId));
  const contactIds = unique(priority.companies.flatMap((company) => company.contacts.map((contact) => contact.contactId)));
  const [contacts, companies, salesSafety, campaign] = await Promise.all([
    batchRead("contacts", contactIds, CONTACT_PROPERTIES),
    batchRead("companies", companyIds, COMPANY_PROPERTIES),
    recentSalesSafety(),
    resolveCampaign(),
  ]);
  const contactById = new Map(contacts.map((record) => [record.id, record]));
  const companyById = new Map(companies.map((record) => [record.id, record]));
  const campaignLeads = getSmartleadApiKey() ? await campaignLeadRows(campaign) : [];
  const existingEmails = new Set(campaignLeads.map((lead) => clean(lead.email).toLowerCase()).filter(Boolean));
  const queue: SmartleadQueueLead[] = [];
  const usedEmails = new Set<string>();

  for (const item of priority.companies) {
    const contactSummary = bestEmailContact(item);
    if (!contactSummary) continue;
    const contact = contactById.get(contactSummary.contactId);
    const company = companyById.get(item.companyId);
    const email = clean(contact?.properties?.email || contactSummary.email).toLowerCase();
    const emailStatus = text(contact, "gtm_email_status");
    const country = text(company, "gtm_country") || text(company, "country") || item.country;
    const industry = text(company, "gtm_industry") || text(company, "industry");
    const title = text(contact, "jobtitle") || contactSummary.contactTitle;
    const names = splitName(contact, contactSummary.contactName);
    let blockReason = "";

    if (!salesSafety.healthy) blockReason = "Sales safety scan unavailable";
    else if (!isValidBusinessEmail(email)) blockReason = "Invalid or unsafe email";
    else if (!emailStatusIsSafe(emailStatus)) blockReason = `Email status: ${emailStatus}`;
    else if (salesSafety.blockedCompanyIds.has(item.companyId)) blockReason = "Recent Sales activity at company";
    else if (salesSafety.blockedContactIds.has(contactSummary.contactId)) blockReason = "Recent Sales activity with contact";
    else if (existingEmails.has(email)) blockReason = "Already in Talentera Smartlead campaign";
    else if (usedEmails.has(email)) blockReason = "Duplicate email in Marita queue";

    usedEmails.add(email);
    queue.push({
      contactId: contactSummary.contactId,
      companyId: item.companyId,
      firstName: names.firstName,
      lastName: names.lastName,
      fullName: clean(`${names.firstName} ${names.lastName}`) || contactSummary.contactName,
      email,
      title,
      companyName: text(company, "name") || item.companyName,
      domain: text(company, "domain") || item.domain,
      country,
      industry,
      industryBucket: industryBucket(industry),
      persona: text(contact, "gtm_persona") || personaBucket(title),
      locale: localeForCountry(country),
      detectedAts: text(company, "detected_ats") || item.detectedAts,
      atsAngle: atsAngle(text(company, "detected_ats") || item.detectedAts),
      linkedinUrl: text(contact, "gtm_linkedin_url"),
      priority: item.priority,
      priorityScore: item.priorityScore,
      eligible: !blockReason,
      blockReason,
    });
  }

  queue.sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.priorityScore - left.priorityScore || left.companyName.localeCompare(right.companyName));
  return { priority, queue, salesSafety, campaign, campaignLeads };
}

function industryPain(bucket: string, locale: OutreachLocale) {
  const english: Record<string, string> = {
    healthcare: "clinical and non-clinical hiring across multiple teams",
    retail: "high-volume frontline hiring across multiple locations",
    logistics: "operational and warehouse hiring at speed",
    "financial-services": "structured hiring with multiple approvals",
    education: "seasonal hiring across multiple departments",
    hospitality: "high-volume operational hiring across locations",
    "construction-real-estate": "project-based hiring across technical and support roles",
    technology: "scaling specialist hiring without adding recruiter admin",
    other: "keeping screening, interviews, approvals and offers in one flow",
    unknown: "keeping screening, interviews, approvals and offers in one flow",
  };
  const arabic: Record<string, string> = {
    healthcare: "التوظيف للوظائف الطبية والإدارية مع تعدد الفرق والموافقات",
    retail: "التوظيف التشغيلي للفروع والتعامل مع أعداد كبيرة من المرشحين",
    logistics: "التوظيف التشغيلي والمستودعات بسرعة ومن غير متابعة يدوية كثيرة",
    "financial-services": "تنظيم مراحل التوظيف والموافقات الداخلية بشكل أوضح",
    education: "التوظيف الموسمي وتعدد الأقسام والاحتياجات",
    hospitality: "التوظيف التشغيلي لعدة مواقع مع حجم مرشحين كبير",
    "construction-real-estate": "التوظيف للمشاريع والوظائف الفنية والإدارية في مسار واحد",
    technology: "تسريع توظيف الكفاءات المتخصصة وتقليل العمل اليدوي على فريق التوظيف",
    other: "ربط الفرز والمقابلات والموافقات والعروض في مسار واحد",
    unknown: "ربط الفرز والمقابلات والموافقات والعروض في مسار واحد",
  };
  return locale === "en" ? english[bucket] || english.other : arabic[bucket] || arabic.other;
}

function fallbackTemplate(locale: OutreachLocale): SequenceTemplate {
  if (locale === "ar-SA") {
    return {
      subject1: "سؤال سريع عن التوظيف في {company_name}",
      touch1: "هلا {first_name}، لفتني حجم التوظيف عند {company_name}. عادةً مع {industry_pain} يصير جزء كبير من وقت الفريق في المتابعة بين الفرز والمقابلات والموافقات. Talentera يجمع الرحلة في مكان واحد ويخفف الشغل اليدوي على فريق التوظيف. هل تحسين هالجزء ضمن أولوياتكم هالفترة؟",
      subject2: "بخصوص رحلة التوظيف في {company_name}",
      touch2: "{first_name}، سبب تواصلي إن كثير من فرق التوظيف يكون عندها نظام قائم لكن تظل بعض الخطوات موزعة بين أدوات ومتابعات يدوية. Talentera يساعد في ربط الفرز والمقابلات والموافقات والعروض في مسار أوضح. يستاهل نشارككم الفكرة بشكل سريع؟",
      subject3: "أقفل الموضوع؟",
      touch3: "{first_name}، ما ودي أثقل عليك. إذا تطوير تجربة التوظيف مو أولوية الآن أقفل الموضوع من جهتي، وإذا مناسب أشاركك الفكرة باختصار.",
    };
  }
  if (locale === "ar-GCC") {
    return {
      subject1: "سؤال سريع عن التوظيف في {company_name}",
      touch1: "أهلًا {first_name}، مع {industry_pain} عادةً تزيد المتابعة اليدوية بين الفرز والمقابلات والموافقات. Talentera يساعد فريق التوظيف يجمع الرحلة في مكان واحد ويكون عنده رؤية أوضح على المرشحين. هل تحسين هذا التدفق ضمن أولوياتكم حاليًا؟",
      subject2: "رحلة التوظيف في {company_name}",
      touch2: "{first_name}، سبب تواصلي أن وجود ATS لا يعني دائمًا أن كل خطوات التوظيف مترابطة. Talentera يربط الفرز والمقابلات والموافقات والعروض ويخفف المتابعة اليدوية. مناسب نشارككم الفكرة بشكل سريع؟",
      subject3: "أقفل الموضوع؟",
      touch3: "{first_name}، إذا تطوير عملية التوظيف مو ضمن الأولويات الآن أقفل الموضوع، وإذا مناسب يسعدني أشاركك الفكرة باختصار.",
    };
  }
  return {
    subject1: "Hiring at {company_name}",
    touch1: "Hi {first_name}, with {industry_pain}, a lot of recruiter time can disappear into moving candidates between screening, interviews and approvals. Talentera brings that journey into one place and gives TA teams a clearer view of the pipeline. Is improving that flow a priority for {company_name} this year?",
    subject2: "Recruitment flow at {company_name}",
    touch2: "Hi {first_name}, one reason I reached out is that even teams with an ATS can still have manual gaps between screening, interviews, approvals and offers. Talentera is built to connect those steps without adding more recruiter admin. Worth a quick look?",
    subject3: "Close the loop?",
    touch3: "Hi {first_name}, if improving the recruitment setup is not a priority right now, I will close the loop. If it is, happy to share the idea briefly.",
  };
}

function parseSequenceTemplate(content: string, locale: OutreachLocale): SequenceTemplate {
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("No JSON object");
    const data = object(JSON.parse(content.slice(start, end + 1)));
    const result: SequenceTemplate = {
      subject1: sanitizeOutreachText(clean(data.subject1), 90),
      touch1: sanitizeOutreachText(clean(data.touch1), 700),
      subject2: sanitizeOutreachText(clean(data.subject2), 90),
      touch2: sanitizeOutreachText(clean(data.touch2), 600),
      subject3: sanitizeOutreachText(clean(data.subject3), 90),
      touch3: sanitizeOutreachText(clean(data.touch3), 420),
    };
    if (Object.values(result).some((value) => !value)) throw new Error("Incomplete copy");
    if (Object.values(result).some((value) => /https?:\/\//i.test(value))) throw new Error("Links are not allowed");
    return result;
  } catch {
    return fallbackTemplate(locale);
  }
}

async function generateSegmentTemplate(lead: SmartleadQueueLead): Promise<SequenceTemplate> {
  const pain = industryPain(lead.industryBucket, lead.locale);
  const fallback = fallbackTemplate(lead.locale);
  try {
    const result = await openRouterCompletion({
      cacheKey: `smartlead-copy-v1:${lead.locale}:${lead.industryBucket}:${lead.persona}:${lead.atsAngle}`,
      mode: "fast",
      maxOutputTokens: 520,
      temperature: 0.35,
      system: [
        "You are a senior B2B cold-email copywriter for Talentera, an applicant tracking and recruitment platform.",
        "Return ONLY one JSON object with keys subject1,touch1,subject2,touch2,subject3,touch3.",
        "Use only these literal placeholders when useful: {first_name}, {company_name}, {industry_pain}.",
        "Never claim you researched, saw, noticed or verified something unless it is provided. No fake compliments, no links, no emojis, no hype, no spammy urgency.",
        "Touch 1: relevance + operational pain + one soft reply CTA, <= 75 words. Touch 2: new angle, never say just following up, <= 60 words. Touch 3: polite close-the-loop, <= 38 words.",
        "If locale is ar-SA, write natural professional Saudi business Arabic: warm and light, not exaggerated slang, not formal fusha. If ar-GCC, use neutral Gulf Arabic. If en, concise natural English.",
        "Do not attack or name the prospect's current ATS. If an ATS exists, position Talentera around workflow improvement and recruiter efficiency.",
      ].join(" "),
      user: JSON.stringify({
        locale: lead.locale,
        industry: lead.industryBucket,
        persona: lead.persona,
        atsContext: lead.atsAngle,
        industryPain: pain,
        product: "Talentera ATS and recruitment platform",
      }),
    });
    return parseSequenceTemplate(result.content, lead.locale);
  } catch {
    return fallback;
  }
}

function renderedLead(lead: SmartleadQueueLead, template: SequenceTemplate): PreparedSmartleadLead {
  const values = {
    first_name: lead.firstName || lead.fullName || "",
    company_name: lead.companyName,
    industry_pain: industryPain(lead.industryBucket, lead.locale),
  };
  return {
    ...lead,
    subject1: sanitizeOutreachText(renderOutreachTemplate(template.subject1, values), 90),
    touch1: sanitizeOutreachText(renderOutreachTemplate(template.touch1, values), 700),
    subject2: sanitizeOutreachText(renderOutreachTemplate(template.subject2, values), 90),
    touch2: sanitizeOutreachText(renderOutreachTemplate(template.touch2, values), 600),
    subject3: sanitizeOutreachText(renderOutreachTemplate(template.subject3, values), 90),
    touch3: sanitizeOutreachText(renderOutreachTemplate(template.touch3, values), 420),
  };
}

export async function getSmartleadCommandCenter(forceRefresh = false): Promise<SmartleadCommandCenterPayload> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.payload;
  const apiConfigured = Boolean(getSmartleadApiKey());
  const built = await buildQueue(forceRefresh);
  const [senders, prepared] = await Promise.all([
    apiConfigured ? smartleadSenders(built.campaign) : Promise.resolve([] as SmartleadSender[]),
    readPreparedBatch(),
  ]);
  const analytics = apiConfigured ? await campaignAnalytics(built.campaign, built.campaignLeads) : { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0 };
  const ready = built.queue.filter((lead) => lead.eligible).length;
  const configuredCap = built.campaign?.maxLeadsPerDay ? Math.min(dailyNewCap(), built.campaign.maxLeadsPerDay) : dailyNewCap();
  const coverage = calculateCoverage(ready, configuredCap);
  const summary = {
    maritaCompanies: built.priority.companies.length,
    emailCandidates: built.queue.length,
    ready,
    blockedBySales: built.queue.filter((lead) => /Sales activity/i.test(lead.blockReason)).length,
    blockedEmail: built.queue.filter((lead) => /email/i.test(lead.blockReason) && !/campaign/i.test(lead.blockReason)).length,
    alreadyInCampaign: built.queue.filter((lead) => /Already in Talentera Smartlead campaign/i.test(lead.blockReason)).length,
    prepared: prepared?.leads.length ?? 0,
    dailyNewCap: coverage.dailyNewCap,
    today: coverage.today,
    tomorrow: coverage.tomorrow,
    next48Hours: coverage.next48Hours,
    coverageDays: coverage.coverageDays,
  };

  const payload: SmartleadCommandCenterPayload = {
    generatedAt: new Date().toISOString(),
    configuration: {
      apiConfigured,
      openRouterConfigured: Boolean(clean(process.env.OPENROUTER_API_KEY, 2_000)),
      ownerActionsConfigured: Boolean(clean(process.env.ACQUISITION_OWNER_TOKEN, 2_000)),
      maritaOwnerId: MARITA_OWNER_ID,
      campaignName: CAMPAIGN_NAME,
      salesLookbackDays: salesLookbackDays(),
    },
    safety: {
      healthy: built.salesSafety.healthy,
      recentSalesActivities: built.salesSafety.activityCount,
      blockedContacts: built.salesSafety.blockedContactIds.size,
      blockedCompanies: built.salesSafety.blockedCompanyIds.size,
      warnings: built.salesSafety.warnings,
    },
    campaign: built.campaign,
    analytics,
    senders,
    summary,
    queue: built.queue.slice(0, 1_000),
    preparedSamples: (prepared?.leads ?? []).slice(0, 5),
  };
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
  return payload;
}

export async function prepareSmartleadBatch(limit?: number) {
  const built = await buildQueue(true);
  if (!built.salesSafety.healthy) throw new Error("Sales safety scan is not healthy. No Smartlead batch was prepared.");
  const cap = Math.min(150, positiveInt(limit, dailyNewCap(), 1, 150), dailyNewCap());
  const leads = built.queue.filter((lead) => lead.eligible).slice(0, cap);
  if (!leads.length) throw new Error("No Marita leads are currently eligible for Smartlead.");

  const templates = new Map<string, SequenceTemplate>();
  for (const lead of leads) {
    const key = `${lead.locale}|${lead.industryBucket}|${lead.persona}|${lead.atsAngle}`;
    if (!templates.has(key)) templates.set(key, await generateSegmentTemplate(lead));
  }
  const preparedLeads = leads.map((lead) => {
    const key = `${lead.locale}|${lead.industryBucket}|${lead.persona}|${lead.atsAngle}`;
    return renderedLead(lead, templates.get(key) ?? fallbackTemplate(lead.locale));
  });
  const batch: PreparedBatch = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceGeneratedAt: built.priority.generatedAt,
    campaignName: CAMPAIGN_NAME,
    leads: preparedLeads,
  };
  await writePreparedBatch(batch);
  cache = null;
  return { prepared: preparedLeads.length, segments: templates.size, samples: preparedLeads.slice(0, 5) };
}

function campaignSequencePayload() {
  return [
    {
      seq_number: 1,
      seq_delay_details: { delay_in_days: 0 },
      variant_distribution_type: "MANUALLY_EQUAL",
      variants: [{ subject: "{{sl_subject_1}}", email_body: "{{sl_touch_1}}", variant_label: "A" }],
    },
    {
      seq_number: 2,
      seq_delay_details: { delay_in_days: 3 },
      variant_distribution_type: "MANUALLY_EQUAL",
      variants: [{ subject: "{{sl_subject_2}}", email_body: "{{sl_touch_2}}", variant_label: "A" }],
    },
    {
      seq_number: 3,
      seq_delay_details: { delay_in_days: 4 },
      variant_distribution_type: "MANUALLY_EQUAL",
      variants: [{ subject: "{{sl_subject_3}}", email_body: "{{sl_touch_3}}", variant_label: "A" }],
    },
  ];
}

export async function bootstrapSmartleadCampaign() {
  let campaign = await resolveCampaign();
  if (!campaign) {
    const created = await smartleadRequest<unknown>("/campaigns/create", {
      method: "POST",
      body: JSON.stringify({ name: CAMPAIGN_NAME, client_id: null }),
    });
    campaign = parseCampaign(created);
    if (!campaign) campaign = await resolveCampaign();
  }
  if (!campaign) throw new Error("Smartlead campaign could not be created.");

  await smartleadRequest(`/campaigns/${campaign.id}/settings`, {
    method: "POST",
    body: JSON.stringify({
      track_settings: ["DONT_EMAIL_OPEN", "DONT_LINK_CLICK"],
      stop_lead_settings: "REPLY_TO_AN_EMAIL",
      unsubscribe_text: "Not relevant? Reply no and I won't follow up.",
      send_as_plain_text: true,
      follow_up_percentage: 100,
      enable_ai_esp_matching: true,
      client_id: null,
    }),
  });
  await smartleadRequest(`/campaigns/${campaign.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({
      timezone: "Asia/Riyadh",
      days_of_the_week: [0, 1, 2, 3, 4],
      start_hour: process.env.SMARTLEAD_START_HOUR || "09:30",
      end_hour: process.env.SMARTLEAD_END_HOUR || "16:30",
      min_time_btw_emails: positiveInt(process.env.SMARTLEAD_MIN_TIME_BETWEEN_EMAILS, 5, 1, 240),
      max_leads_per_day: dailyNewCap(),
    }),
  });
  await smartleadRequest(`/campaigns/${campaign.id}/sequences`, {
    method: "POST",
    body: JSON.stringify(campaignSequencePayload()),
  });
  cache = null;
  return { campaign: await resolveCampaign(), configured: true, activated: false };
}

export async function attachSmartleadSenders(senderIds: number[]) {
  const campaign = await resolveCampaign();
  if (!campaign) throw new Error("Create the Talentera Smartlead campaign first.");
  const validIds = new Set((await smartleadSenders(campaign)).map((sender) => sender.id));
  const selected = [...new Set(senderIds)].filter((id) => validIds.has(id)).slice(0, 50);
  if (!selected.length) throw new Error("No valid Smartlead sender accounts were selected.");
  await smartleadRequest(`/campaigns/${campaign.id}/email-accounts`, {
    method: "POST",
    body: JSON.stringify({ email_account_ids: selected }),
  });
  cache = null;
  return { attached: selected.length, senderIds: selected };
}

export async function setSmartleadCampaignStatus(status: "START" | "PAUSED") {
  const campaign = await resolveCampaign();
  if (!campaign) throw new Error("Create the Talentera Smartlead campaign first.");
  if (status === "START") {
    const assigned = await campaignAssignedSenderIds(campaign);
    if (!assigned.size) throw new Error("Attach at least one sender before starting the campaign.");
  }
  await smartleadRequest(`/campaigns/${campaign.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  cache = null;
  return { status, campaign: await resolveCampaign() };
}

function smartleadLeadPayload(lead: PreparedSmartleadLead) {
  return {
    email: lead.email,
    first_name: lead.firstName,
    last_name: lead.lastName,
    company_name: lead.companyName,
    website: lead.domain ? `https://${lead.domain}` : "",
    location: lead.country,
    linkedin_profile: lead.linkedinUrl,
    company_url: lead.domain ? `https://${lead.domain}` : "",
    custom_fields: {
      sl_subject_1: lead.subject1,
      sl_touch_1: lead.touch1,
      sl_subject_2: lead.subject2,
      sl_touch_2: lead.touch2,
      sl_subject_3: lead.subject3,
      sl_touch_3: lead.touch3,
      sdr_owner: "Marita",
      hubspot_contact_id: lead.contactId,
      hubspot_company_id: lead.companyId,
      locale: lead.locale,
      industry: lead.industryBucket,
      persona: lead.persona,
      ats: lead.detectedAts,
    },
  };
}

export async function launchPreparedSmartleadBatch() {
  const prepared = await readPreparedBatch();
  if (!prepared?.leads.length) throw new Error("Prepare a Smartlead batch first.");
  const campaign = await resolveCampaign();
  if (!campaign) throw new Error("Create the Talentera Smartlead campaign first.");
  const assigned = await campaignAssignedSenderIds(campaign);
  if (!assigned.size) throw new Error("Attach sender accounts before sending leads to Smartlead.");

  const fresh = await buildQueue(true);
  if (!fresh.salesSafety.healthy) throw new Error("Sales safety scan is not healthy. Launch blocked.");
  const eligible = new Map(fresh.queue.filter((lead) => lead.eligible).map((lead) => [lead.email.toLowerCase(), lead]));
  const safeLeads = prepared.leads.filter((lead) => {
    const current = eligible.get(lead.email.toLowerCase());
    return current && current.contactId === lead.contactId && current.companyId === lead.companyId;
  });
  if (!safeLeads.length) throw new Error("Every prepared lead was removed by the fresh safety check. Nothing was sent to Smartlead.");

  const responses: unknown[] = [];
  for (let index = 0; index < safeLeads.length; index += 400) {
    const chunk = safeLeads.slice(index, index + 400);
    const response = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/leads`, {
      method: "POST",
      body: JSON.stringify({
        lead_list: chunk.map(smartleadLeadPayload),
        settings: {
          ignore_global_block_list: false,
          ignore_unsubscribe_list: false,
          ignore_community_bounce_list: false,
          ignore_duplicate_leads_in_other_campaign: false,
        },
      }),
    });
    responses.push(response);
  }

  await writePreparedBatch({ ...prepared, leads: [], launchedAt: new Date().toISOString() });
  cache = null;
  return {
    requested: prepared.leads.length,
    queued: safeLeads.length,
    skippedByFreshSafetyCheck: prepared.leads.length - safeLeads.length,
    campaignId: campaign.id,
    campaignStatus: campaign.status,
    responses,
  };
}
