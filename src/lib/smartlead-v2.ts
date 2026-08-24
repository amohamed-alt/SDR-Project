import fs from "node:fs/promises";
import path from "node:path";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { getMaritaPriorityQueue, type MaritaPriorityCompany } from "@/lib/marita-priority";
import { openRouterCompletion } from "@/lib/openrouter-low-cost";
import { getOutreachVerificationSnapshot, type VisibleVerificationStatus } from "@/lib/outreach-email-waterfall";
import {
  decideRecipientLanguage,
  isGccCountry,
  isKsaCountry,
  type OutreachProduct,
  type RecipientLocale,
  type SenderBrand,
} from "@/lib/recipient-language-routing";
import { inspectSenderAccount, validateApprovedSenderInventory } from "@/lib/smartlead-sender-routing";
import { DAILY_LANE_NEW_CAPS, verificationCandidatesForLane } from "@/lib/smartlead-daily-routing";
import { VISIBLE_SEQUENCE_LANES, laneFor, type OutreachLane } from "@/lib/smartlead-visible-sequences";
import { SALES_REP_OWNER_IDS } from "@/lib/sales-reps";
import { emailStatusIsSafe, industryBucket, isValidBusinessEmail, personaBucket, renderOutreachTemplate, safeOpeningLineForLocale, sanitizeOutreachText } from "@/lib/smartlead-policy";
import type { HubSpotRecord } from "@/lib/types";

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
const MARITA_OWNER_ID = "31644369";
const CACHE_TTL_MS = 2 * 60 * 1000;
const TOUCH_COUNT = 3;
const MIN_GAP_MINUTES = 15;
const AI_ARABIC_CONFIDENCE = 0.97;
const GLOBAL_DAILY_NEW_DEFAULT = 50;
const MAX_CAMPAIGN_EMAILS_PER_MAILBOX = 20;

const PRODUCT_CONFIG: Record<OutreachProduct, { name: string; brandLabel: string }> = {
  talentera: { name: process.env.SMARTLEAD_TALENTERA_CAMPAIGN_NAME || "Talentera | Marita SDR | V2 3-Touch", brandLabel: "Talentera" },
  evalify: { name: process.env.SMARTLEAD_EVALIFY_CAMPAIGN_NAME || "Evalify | Marita SDR | V2 3-Touch", brandLabel: "Evalify" },
};

const PREPARED_PATH = process.env.SMARTLEAD_V2_PREPARED_PATH || "/app/data/smartlead-v2-prepared.json";
const LEDGER_PATH = process.env.SMARTLEAD_V2_LEDGER_PATH || "/app/data/smartlead-v2-ledger.json";
const INTELLIGENCE_PATH = process.env.SMARTLEAD_V2_INTELLIGENCE_PATH || "/app/data/smartlead-v2-intelligence.json";

const CONTACT_PROPERTIES = ["firstname", "lastname", "email", "work_email", "jobtitle", "country", "gtm_email_status", "gtm_persona", "gtm_linkedin_url", "email_enrichment_status", "signalhire_match_status", "signalhire_last_enriched_at"] as const;
const COMPANY_PROPERTIES = ["name", "domain", "country", "gtm_country", "industry", "gtm_industry", "detected_ats", "ats_status", "career_page_url"] as const;

type JsonObject = Record<string, unknown>;
type SalesActivityType = "emails" | "meetings" | "communications";
const SALES_ACTIVITY_PROPERTIES: Record<SalesActivityType, readonly string[]> = {
  emails: ["hs_timestamp", "hubspot_owner_id", "hs_email_direction", "hs_email_status"],
  meetings: ["hs_timestamp", "hs_meeting_start_time", "hubspot_owner_id", "hs_meeting_outcome"],
  communications: ["hs_timestamp", "hubspot_owner_id", "hs_communication_channel_type", "hs_communication_logged_from"],
};

export type V2Campaign = { id: number; name: string; status: string; maxLeadsPerDay: number; timezone: string; product: OutreachProduct };
export type V2Sender = {
  id: number;
  email: string;
  fromName: string;
  maxPerDay: number;
  warmupEnabled: boolean;
  warmupKnown: boolean;
  brand: SenderBrand;
  assignedProducts: OutreachProduct[];
  eligible: boolean;
  safetyReasons: string[];
};

export type V2Lead = {
  contactId: string;
  companyId: string;
  firstName: string;
  greetingName: string;
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
  locale: RecipientLocale;
  languageConfidence: number;
  languageReason: string;
  nameTranslated: boolean;
  detectedAts: string;
  atsStatus: string;
  product: OutreachProduct;
  productReason: string;
  linkedinUrl: string;
  priority: string;
  priorityScore: number;
  eligible: boolean;
  blockReason: string;
  executionStatus: string;
  lane: OutreachLane;
  campaignName: string;
  lanePosition: number;
  batchNumber: number;
  batchLabel: string;
  verification: {
    status: VisibleVerificationStatus;
    checkedAt: string;
    source: "current" | "signalhire" | "none";
    cacheFresh: boolean;
    signalHireAttempted: boolean;
    replacementUsed: boolean;
    reason: string;
  };
};

export type PreparedV2Lead = V2Lead & {
  openingLine: string;
  subject1: string;
  touch1: string;
  subject2: string;
  touch2: string;
  subject3: string;
  touch3: string;
};

type PreparedBatch = { version: 2; createdAt: string; sourceGeneratedAt: string; leads: PreparedV2Lead[] };
type LedgerEntry = { email: string; contactId: string; companyId: string; product: OutreachProduct; campaignId: number; queuedAt: string; lastKnownStatus: string };
type Ledger = { version: 1; entries: LedgerEntry[] };
type IntelligenceEntry = { key: string; locale: RecipientLocale; greetingName: string; confidence: number; reason: string; openingLine: string; updatedAt: string };
type IntelligenceStore = { version: 1; entries: IntelligenceEntry[] };
type SalesSafety = { healthy: boolean; blockedContactIds: Set<string>; blockedCompanyIds: Set<string>; activityCount: number; warnings: string[] };
type SequenceTemplate = { subject1: string; touch1: string; subject2: string; touch2: string; subject3: string; touch3: string };

export type V2Execution = {
  email: string;
  contactId: string;
  companyId: string;
  product: OutreachProduct;
  campaignName: string;
  status: string;
  sequenceStep: number;
  queuedAt: string;
};

export type SmartleadV2Payload = {
  generatedAt: string;
  configuration: {
    apiConfigured: boolean;
    openRouterConfigured: boolean;
    ownerActionsConfigured: boolean;
    maritaOwnerId: string;
    globalDailyNewTarget: number;
    minTimeBetweenEmails: number;
    maxCampaignEmailsPerMailbox: number;
  };
  safety: { healthy: boolean; recentSalesActivities: number; blockedContacts: number; blockedCompanies: number; warnings: string[] };
  campaigns: Record<OutreachProduct, V2Campaign | null>;
  analytics: Record<OutreachProduct, { sent: number; replies: number; bounces: number; unsubscribed: number; activeLeads: number; bounceRate: number }>;
  senders: V2Sender[];
  capacity: {
    totalInboxes: number;
    eligibleInboxes: number;
    assignedInboxes: number;
    potentialCampaignEmailsPerDay: number;
    liveCampaignEmailsPerDay: number;
    potentialNewLeadsPerDay: number;
    liveNewLeadsPerDay: number;
    productLiveNewCaps: Record<OutreachProduct, number>;
  };
  summary: {
    maritaCompanies: number;
    emailCandidates: number;
    ready: number;
    talenteraReady: number;
    evalifyReady: number;
    blockedBySales: number;
    blockedEmail: number;
    alreadyEntered: number;
    prepared: number;
    today: number;
    tomorrow: number;
    next48Hours: number;
    coverageDays: number;
  };
  queue: V2Lead[];
  preparedSamples: PreparedV2Lead[];
  executions: V2Execution[];
  sequenceCatalog: Record<OutreachProduct, { arSA: SequenceTemplate; en: SequenceTemplate }>;
};

type CacheEntry = { expiresAt: number; payload: SmartleadV2Payload };
let cache: CacheEntry | null = null;

function clean(value: unknown, max = 2_000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function text(record: HubSpotRecord | undefined, key: string) { return clean(record?.properties?.[key]); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function list(value: unknown, keys: string[] = []) { if (Array.isArray(value)) return value; const item = object(value); for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[]; return [] as unknown[]; }
function numberFrom(value: unknown, keys: string[]) { const item = object(value); for (const key of keys) { const parsed = Number(item[key]); if (Number.isFinite(parsed)) return parsed; } return 0; }
function positiveInt(value: unknown, fallback: number, min = 1, max = 10_000) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback; }
function globalDailyTarget() { return positiveInt(process.env.SMARTLEAD_DAILY_NEW_LEADS, GLOBAL_DAILY_NEW_DEFAULT, 1, 200); }
function salesLookbackDays() { return positiveInt(process.env.SMARTLEAD_SALES_ACTIVITY_LOOKBACK_DAYS, 45, 1, 365); }
function unique(values: string[]) { return [...new Set(values.map((value) => clean(value)).filter(Boolean))]; }
function getApiKey() { return clean(process.env.SMARTLEAD_API_KEY); }
function aiConfigured() { return Boolean(clean(process.env.OPENROUTER_API_KEY)); }

async function readJsonFile<T>(file: string, fallback: T): Promise<T> { try { return JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file, "utf8")) as T; } catch { return fallback; } }
async function writeJsonFile(file: string, value: unknown) { await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true }); const tmp = `${file}.tmp-${process.pid}`; await fs.writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 }); await fs.rename(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ file); }
async function readPrepared() { return readJsonFile<PreparedBatch | null>(PREPARED_PATH, null); }
async function readLedger() { return readJsonFile<Ledger>(LEDGER_PATH, { version: 1, entries: [] }); }
async function readIntelligence() { return readJsonFile<IntelligenceStore>(INTELLIGENCE_PATH, { version: 1, entries: [] }); }

async function smartleadRequest<T>(endpoint: string, init: RequestInit = {}, extraQuery: Record<string, string> = {}): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("SMARTLEAD_API_KEY is not configured.");
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
      if (response.ok) { if (response.status === 204) return undefined as T; return await response.json() as T; }
      const body = (await response.text()).slice(0, 800);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) { await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt)); continue; }
      throw new Error(`Smartlead API request failed (${response.status}): ${body}`);
    } catch (error) { lastError = error; if (attempt >= 3) throw error; await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt)); }
  }
  throw lastError instanceof Error ? lastError : new Error("Smartlead API request failed.");
}

function productFromCampaignName(name: string): OutreachProduct | null {
  if (/^evalif[uy]\b/i.test(clean(name))) return "evalify";
  if (/^talentera\b/i.test(clean(name))) return "talentera";
  return null;
}
function parseCampaign(value: unknown): V2Campaign | null {
  const item = object(value); const id = Number(item.id); if (!Number.isFinite(id)) return null;
  const name = clean(item.name); const product = productFromCampaignName(name); if (!product) return null;
  const cron = object(item.scheduler_cron_value);
  return { id, name, product, status: clean(item.status) || "UNKNOWN", maxLeadsPerDay: numberFrom(item, ["max_leads_per_day", "maxLeadsPerDay"]), timezone: clean(cron.tz || item.timezone) };
}
async function listCampaigns() {
  if (!getApiKey()) return [] as V2Campaign[];
  const payload = await smartleadRequest<unknown>("/campaigns/", { method: "GET" }, { include_tags: "true" });
  return list(payload, ["campaigns", "data"]).map(parseCampaign).filter((item): item is V2Campaign => Boolean(item));
}
function currentProductCampaign(product: OutreachProduct, campaigns: V2Campaign[]) { return campaigns.find((campaign) => campaign.name === PRODUCT_CONFIG[product].name) ?? null; }
function isManagedCampaign(campaign: V2Campaign) { return /Marita SDR/i.test(campaign.name) && (campaign.product === "talentera" || campaign.product === "evalify"); }
async function campaignLeadRows(campaign: V2Campaign | null) {
  if (!campaign) return [] as JsonObject[];
  const rows: JsonObject[] = [];
  for (let offset = 0; offset < 20_000; offset += 100) {
    const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/leads`, { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(payload, ["leads", "data", "results"]).map(object); rows.push(...batch); if (batch.length < 100) break;
  }
  return rows;
}
async function campaignSenderIds(campaign: V2Campaign | null) {
  if (!campaign) return new Set<number>();
  const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/email-accounts`, { method: "GET" });
  return new Set(list(payload, ["email_accounts", "data", "accounts"]).map((value) => Number(object(value).id ?? object(value).email_account_id)).filter(Number.isFinite));
}
async function listAllEmailAccounts() {
  if (!getApiKey()) return [] as unknown[];
  const rows: unknown[] = [];
  for (let offset = 0; offset < 5_000; offset += 100) {
    const payload = await smartleadRequest<unknown>("/email-accounts/", { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(payload, ["email_accounts", "data", "accounts"]); rows.push(...batch); if (batch.length < 100) break;
  }
  return rows;
}
function parseSender(value: unknown, assigned: Record<OutreachProduct, Set<number>>): V2Sender | null {
  const item = object(value); const id = Number(item.id ?? item.email_account_id); if (!Number.isFinite(id)) return null;
  const safety = inspectSenderAccount(item, MAX_CAMPAIGN_EMAILS_PER_MAILBOX);
  return {
    id, email: safety.email, fromName: clean(item.from_name || item.name), maxPerDay: safety.dailyLimit,
    warmupEnabled: safety.warmupEnabled, warmupKnown: safety.warmupKnown, brand: safety.brand,
    assignedProducts: (["talentera", "evalify"] as OutreachProduct[]).filter((product) => assigned[product].has(id)),
    eligible: safety.eligible,
    safetyReasons: safety.reasons,
  };
}
async function getSenders(campaigns: Record<OutreachProduct, V2Campaign | null>) {
  if (!getApiKey()) return [] as V2Sender[];
  const [raw, talenteraIds, evalifyIds] = await Promise.all([listAllEmailAccounts(), campaignSenderIds(campaigns.talentera), campaignSenderIds(campaigns.evalify)]);
  const assigned = { talentera: talenteraIds, evalify: evalifyIds };
  return raw.map((row) => parseSender(row, assigned)).filter((row): row is V2Sender => Boolean(row));
}

async function analytics(campaign: V2Campaign | null, rows: JsonObject[]) {
  if (!campaign) return { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0, bounceRate: 0 };
  const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/analytics`, { method: "GET" }).catch(() => ({}));
  const sent = numberFrom(payload, ["sent_count", "sent", "total_sent", "emails_sent"]); const bounces = numberFrom(payload, ["bounce_count", "bounces", "total_bounces"]);
  return {
    sent, replies: numberFrom(payload, ["reply_count", "replies", "total_replies"]), bounces,
    unsubscribed: numberFrom(payload, ["unsubscribe_count", "unsubscribed", "total_unsubscribed"]),
    activeLeads: rows.filter((row) => !Boolean(row.is_unsubscribed) && !/(?:completed|stopped|paused)/i.test(clean(row.status || row.lead_status))).length,
    bounceRate: sent ? bounces / sent : 0,
  };
}

async function scanSalesActivities(type: SalesActivityType, cutoff: string) {
  try {
    const activities = await searchAll(type, SALES_ACTIVITY_PROPERTIES[type], [
      { propertyName: "hubspot_owner_id", operator: "IN", values: [...SALES_REP_OWNER_IDS] },
      { propertyName: "hs_timestamp", operator: "GTE", value: cutoff },
    ]);
    const ids = activities.map((activity) => activity.id);
    const [contacts, companies] = await Promise.all([readAssociations(type, "contacts", ids), readAssociations(type, "companies", ids)]);
    return { activities, contacts, companies, error: "" };
  } catch (error) { return { activities: [] as HubSpotRecord[], contacts: new Map<string, string[]>(), companies: new Map<string, string[]>(), error: error instanceof Error ? error.message : "Unknown HubSpot activity error" }; }
}
async function recentSalesSafety(): Promise<SalesSafety> {
  const cutoff = String(Date.now() - salesLookbackDays() * 86_400_000);
  const scans = await Promise.all((Object.keys(SALES_ACTIVITY_PROPERTIES) as SalesActivityType[]).map((type) => scanSalesActivities(type, cutoff)));
  const warnings = scans.filter((scan) => scan.error).map((scan) => scan.error); const blockedContactIds = new Set<string>(); const blockedCompanyIds = new Set<string>(); const salesContactIds = new Set<string>(); let activityCount = 0;
  for (const scan of scans) { activityCount += scan.activities.length; for (const activity of scan.activities) { for (const id of scan.contacts.get(activity.id) ?? []) { blockedContactIds.add(id); salesContactIds.add(id); } for (const id of scan.companies.get(activity.id) ?? []) blockedCompanyIds.add(id); } }
  if (salesContactIds.size) try { const associations = await readAssociations("contacts", "companies", [...salesContactIds]); for (const companyIds of associations.values()) for (const id of companyIds) blockedCompanyIds.add(id); } catch (error) { warnings.push(error instanceof Error ? error.message : "Contact-company sales association check failed"); }
  return { healthy: warnings.length === 0, blockedContactIds, blockedCompanyIds, activityCount, warnings };
}

export async function getSmartleadSalesSafetySnapshot() {
  const safety = await recentSalesSafety();
  return {
    healthy: safety.healthy,
    blockedContactIds: [...safety.blockedContactIds],
    blockedCompanyIds: [...safety.blockedCompanyIds],
    activityCount: safety.activityCount,
    warnings: safety.warnings,
  };
}

function bestEmailContact(company: MaritaPriorityCompany) {
  return company.contacts.find((contact) => isValidBusinessEmail(contact.email)) ?? company.contacts[0] ?? null;
}
function splitName(record: HubSpotRecord | undefined, fallback: string) { const firstName = text(record, "firstname"); const lastName = text(record, "lastname"); if (firstName || lastName) return { firstName, lastName }; const parts = clean(fallback).split(/\s+/).filter(Boolean); return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") }; }

export function routeProductFromAts(detectedAts: string, atsStatus = ""): { product: OutreachProduct; reason: string } {
  const ats = clean(detectedAts); const status = clean(atsStatus);
  if (!ats || /^(?:unknown|no visible ats|no ats|not detected|none|n\/a|-+)$/i.test(ats)) return { product: "talentera", reason: "No verified ATS is visible, so Talentera is the primary ATS/workflow offer" };
  if (/unknown|not detected/i.test(status) && /unknown/i.test(ats)) return { product: "talentera", reason: "ATS is unverified, so do not assume an existing system" };
  return { product: "evalify", reason: ats.toLowerCase() === "custom" ? "A custom recruitment system is present; position Evalify as the assessment layer" : `Existing ATS detected (${ats}); position Evalify as the assessment/screening layer without replacing it` };
}

function executionStatus(row: JsonObject) {
  if (Boolean(row.is_unsubscribed) || /unsubscribe/i.test(clean(row.status || row.lead_status))) return "UNSUBSCRIBED";
  if (/bounce/i.test(clean(row.status || row.lead_status || row.email_status))) return "BOUNCED";
  if (/repl|interested/i.test(clean(row.status || row.lead_status || row.category))) return "REPLIED";
  if (/complete/i.test(clean(row.status || row.lead_status))) return "COMPLETED";
  const step = numberFrom(row, ["last_email_sequence_sent", "sequence_number", "current_sequence_number", "last_sequence_number"]);
  if (step >= 3) return "TOUCH_3_SENT"; if (step === 2) return "TOUCH_2_SENT"; if (step === 1) return "TOUCH_1_SENT";
  return clean(row.status || row.lead_status) || "IN_SEQUENCE";
}
function executionStep(row: JsonObject) { return numberFrom(row, ["last_email_sequence_sent", "sequence_number", "current_sequence_number", "last_sequence_number"]); }

function buildExecutions(managedRows: { campaign: V2Campaign; rows: JsonObject[] }[], ledger: Ledger): V2Execution[] {
  const byEmail = new Map<string, V2Execution>();
  for (const entry of ledger.entries) byEmail.set(entry.email.toLowerCase(), { email: entry.email, contactId: entry.contactId, companyId: entry.companyId, product: entry.product, campaignName: PRODUCT_CONFIG[entry.product].name, status: entry.lastKnownStatus || "QUEUED", sequenceStep: 0, queuedAt: entry.queuedAt });
  for (const { campaign, rows } of managedRows) for (const row of rows) {
    const email = clean(row.email).toLowerCase(); if (!email) continue; const existing = byEmail.get(email);
    byEmail.set(email, {
      email, contactId: clean(object(row.custom_fields).hubspot_contact_id) || existing?.contactId || "", companyId: clean(object(row.custom_fields).hubspot_company_id) || existing?.companyId || "",
      product: campaign.product, campaignName: campaign.name, status: executionStatus(row), sequenceStep: executionStep(row), queuedAt: existing?.queuedAt || clean(row.created_at || row.createdAt),
    });
  }
  return [...byEmail.values()].sort((a, b) => (b.queuedAt || "").localeCompare(a.queuedAt || ""));
}

function intelligenceKey(email: string, product: OutreachProduct) { return `${clean(email).toLowerCase()}|${product}`; }
function freshIntelligence(entry: IntelligenceEntry | undefined) { return entry && Date.now() - new Date(entry.updatedAt).getTime() < 30 * 86_400_000 ? entry : undefined; }

async function buildQueue(forceRefresh: boolean) {
  const priority = await getMaritaPriorityQueue(forceRefresh); if (priority.ownerId !== MARITA_OWNER_ID) throw new Error("Marita owner safety boundary failed.");
  const companyIds = unique(priority.companies.map((company) => company.companyId)); const contactIds = unique(priority.companies.flatMap((company) => company.contacts.map((contact) => contact.contactId)));
  const [contacts, companies, salesSafety, allCampaigns, ledger, intelligence] = await Promise.all([
    batchRead("contacts", contactIds, CONTACT_PROPERTIES), batchRead("companies", companyIds, COMPANY_PROPERTIES), recentSalesSafety(), listCampaigns(), readLedger(), readIntelligence(),
  ]);
  const contactById = new Map(contacts.map((record) => [record.id, record])); const companyById = new Map(companies.map((record) => [record.id, record]));
  const managedCampaigns = allCampaigns.filter(isManagedCampaign); const managedRows = await Promise.all(managedCampaigns.map(async (campaign) => ({ campaign, rows: await campaignLeadRows(campaign) })));
  const executions = buildExecutions(managedRows, ledger); const enteredEmails = new Set(executions.map((entry) => entry.email.toLowerCase()));
  const queue: V2Lead[] = []; const usedEmails = new Set<string>();

  for (const item of priority.companies) {
    const contactSummary = bestEmailContact(item); if (!contactSummary) continue;
    const contact = contactById.get(contactSummary.contactId); const company = companyById.get(item.companyId); const email = clean(contact?.properties?.email || contactSummary.email).toLowerCase();
    const country = text(company, "gtm_country") || text(company, "country") || item.country; const industry = text(company, "gtm_industry") || text(company, "industry"); const title = text(contact, "jobtitle") || contactSummary.contactTitle; const names = splitName(contact, contactSummary.contactName);
    const detectedAts = text(company, "detected_ats") || item.detectedAts; const atsStatus = text(company, "ats_status"); const productDecision = routeProductFromAts(detectedAts, atsStatus);
    const deterministic = decideRecipientLanguage({ firstName: names.firstName, lastName: names.lastName, fullName: contactSummary.contactName, country });
    // Deterministic name/language routing is authoritative on every refresh.
    // Cached AI enrichment may supply copy later, but must never preserve a stale
    // or less-safe language decision after the name library changes.
    const locale = deterministic.locale; const greetingName = deterministic.greetingName; const confidence = deterministic.confidence; const reason = deterministic.reason;
    const emailStatus = text(contact, "gtm_email_status"); let blockReason = "";
    if (!salesSafety.healthy) blockReason = "Sales safety scan unavailable";
    else if (!isValidBusinessEmail(email)) blockReason = "Invalid or unsafe email";
    else if (!emailStatusIsSafe(emailStatus)) blockReason = `Email status: ${emailStatus}`;
    else if (salesSafety.blockedCompanyIds.has(item.companyId)) blockReason = "Recent Sales activity at company";
    else if (salesSafety.blockedContactIds.has(contactSummary.contactId)) blockReason = "Recent Sales activity with contact";
    else if (enteredEmails.has(email)) blockReason = "Already entered a managed Smartlead sequence";
    else if (usedEmails.has(email)) blockReason = "Duplicate email in Marita queue";
    if (email) usedEmails.add(email);
    const lane = laneFor(productDecision.product, locale);
    queue.push({
      contactId: contactSummary.contactId, companyId: item.companyId, firstName: names.firstName, greetingName, lastName: names.lastName,
      fullName: clean(`${names.firstName} ${names.lastName}`) || contactSummary.contactName, email, title, companyName: text(company, "name") || item.companyName,
      domain: text(company, "domain") || item.domain, country, industry, industryBucket: industryBucket(industry), persona: text(contact, "gtm_persona") || personaBucket(title),
      locale, languageConfidence: confidence, languageReason: reason, nameTranslated: greetingName !== names.firstName, detectedAts, atsStatus,
      product: productDecision.product, productReason: productDecision.reason, linkedinUrl: text(contact, "gtm_linkedin_url"), priority: item.priority, priorityScore: item.priorityScore,
      eligible: !blockReason, blockReason, executionStatus: blockReason.includes("Already entered") ? executions.find((entry) => entry.email === email)?.status || "ALREADY_ENTERED" : "READY",
      lane, campaignName: VISIBLE_SEQUENCE_LANES[lane].campaignName, lanePosition: 0, batchNumber: 0, batchLabel: "Waiting",
      verification: { status: "not_checked", checkedAt: "", source: "none", cacheFresh: false, signalHireAttempted: false, replacementUsed: false, reason: "Waiting for MillionVerifier." },
    });
  }
  queue.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.priorityScore - a.priorityScore || a.companyName.localeCompare(b.companyName));
  const campaigns: Record<OutreachProduct, V2Campaign | null> = { talentera: currentProductCampaign("talentera", allCampaigns), evalify: currentProductCampaign("evalify", allCampaigns) };
  return { priority, queue, salesSafety, campaigns, managedRows, executions, ledger, intelligence };
}

async function decorateQueue(queue: V2Lead[]) {
  const snapshot = await getOutreachVerificationSnapshot(queue.map((lead) => ({ contactId: lead.contactId, email: lead.email })));
  const positionByContact = new Map<string, number>();
  for (const lane of Object.keys(DAILY_LANE_NEW_CAPS) as OutreachLane[]) {
    verificationCandidatesForLane(queue, lane).forEach((lead, index) => positionByContact.set(lead.contactId, index + 1));
  }
  for (const lead of queue) {
    const verification = snapshot.get(lead.contactId);
    const position = positionByContact.get(lead.contactId) || 0;
    const batchNumber = position ? Math.ceil(position / DAILY_LANE_NEW_CAPS[lead.lane]) : 0;
    lead.lanePosition = position;
    lead.batchNumber = batchNumber;
    lead.batchLabel = batchNumber === 1 ? "Today" : batchNumber === 2 ? "Next batch" : batchNumber ? `Batch ${batchNumber}` : "Blocked";
    if (verification) lead.verification = verification;
  }
  return queue;
}

export async function getSmartleadRoutingSnapshot(forceRefresh = false) {
  const built = await buildQueue(forceRefresh);
  const assigned = { talentera: new Set<number>(), evalify: new Set<number>() };
  const senders = (await listAllEmailAccounts()).map((row) => parseSender(row, assigned)).filter((row): row is V2Sender => Boolean(row));
  return { queue: await decorateQueue(built.queue), senders };
}

function senderCapacity(sender: V2Sender) { return Math.min(Math.max(0, sender.maxPerDay), MAX_CAMPAIGN_EMAILS_PER_MAILBOX); }
function capacityPlan(senders: V2Sender[]) {
  const inventory = validateApprovedSenderInventory(senders);
  if (!inventory.healthy) return { totalInboxes: senders.length, eligibleInboxes: 0, assignedInboxes: 0, potentialCampaignEmailsPerDay: 0, liveCampaignEmailsPerDay: 0, potentialNewLeadsPerDay: 0, liveNewLeadsPerDay: 0, productLiveNewCaps: { talentera: 0, evalify: 0 } };
  const eligible = senders.filter((sender) => sender.eligible); const assigned = eligible.filter((sender) => sender.assignedProducts.includes(sender.brand as OutreachProduct));
  const potentialCampaignEmailsPerDay = eligible.reduce((sum, sender) => sum + senderCapacity(sender), 0); const liveCampaignEmailsPerDay = assigned.reduce((sum, sender) => sum + senderCapacity(sender), 0);
  const potentialNew = Math.floor(potentialCampaignEmailsPerDay / TOUCH_COUNT); const liveNew = Math.floor(liveCampaignEmailsPerDay / TOUCH_COUNT); const global = globalDailyTarget();
  const rawProductCaps: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) rawProductCaps[product] = Math.floor(assigned.filter((sender) => sender.brand === product).reduce((sum, sender) => sum + senderCapacity(sender), 0) / TOUCH_COUNT);
  const liveGlobal = Math.min(global, liveNew); const rawTotal = rawProductCaps.talentera + rawProductCaps.evalify; const productLiveNewCaps: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  if (rawTotal > 0 && liveGlobal > 0) {
    productLiveNewCaps.talentera = Math.min(rawProductCaps.talentera, Math.round(liveGlobal * rawProductCaps.talentera / rawTotal));
    productLiveNewCaps.evalify = Math.min(rawProductCaps.evalify, liveGlobal - productLiveNewCaps.talentera);
    const used = productLiveNewCaps.talentera + productLiveNewCaps.evalify; if (used < liveGlobal) {
      const tRoom = rawProductCaps.talentera - productLiveNewCaps.talentera; const eRoom = rawProductCaps.evalify - productLiveNewCaps.evalify;
      if (tRoom >= eRoom) productLiveNewCaps.talentera += Math.min(tRoom, liveGlobal - used); else productLiveNewCaps.evalify += Math.min(eRoom, liveGlobal - used);
    }
  }
  return { totalInboxes: senders.length, eligibleInboxes: eligible.length, assignedInboxes: assigned.length, potentialCampaignEmailsPerDay, liveCampaignEmailsPerDay, potentialNewLeadsPerDay: Math.min(global, potentialNew), liveNewLeadsPerDay: liveGlobal, productLiveNewCaps };
}

function industryPain(bucket: string, locale: RecipientLocale, product: OutreachProduct) {
  const talenteraEn: Record<string, string> = { healthcare: "clinical and non-clinical hiring across multiple teams", retail: "high-volume frontline hiring across locations", logistics: "operational and warehouse hiring at speed", "financial-services": "structured hiring with multiple approvals", education: "seasonal hiring across departments", hospitality: "high-volume operational hiring across locations", technology: "specialist hiring without extra recruiter admin", other: "screening, interviews, approvals and offers across one recruitment flow", unknown: "screening, interviews, approvals and offers across one recruitment flow" };
  const talenteraAr: Record<string, string> = { healthcare: "التوظيف للوظائف الطبية والإدارية مع تعدد الفرق والموافقات", retail: "التوظيف التشغيلي للفروع والتعامل مع أعداد كبيرة من المرشحين", logistics: "التوظيف التشغيلي والمستودعات بسرعة", "financial-services": "تنظيم مراحل التوظيف والموافقات الداخلية", education: "التوظيف الموسمي وتعدد الأقسام", hospitality: "التوظيف التشغيلي لعدة مواقع", technology: "توظيف الكفاءات المتخصصة وتقليل العمل اليدوي", other: "ربط الفرز والمقابلات والموافقات والعروض", unknown: "ربط الفرز والمقابلات والموافقات والعروض" };
  const evalifyEn: Record<string, string> = { healthcare: "screening clinical and non-clinical candidates consistently before interviews", retail: "screening high applicant volumes before recruiter interviews", logistics: "assessing operational candidates quickly and consistently", "financial-services": "standardising candidate assessments and shortlisting", education: "screening applicants consistently across departments", hospitality: "assessing high-volume operational applicants before interviews", technology: "validating specialist skills before recruiter and hiring-manager time is used", other: "screening and assessing candidates before interviews", unknown: "screening and assessing candidates before interviews" };
  const evalifyAr: Record<string, string> = { healthcare: "فرز وتقييم المرشحين للوظائف الطبية والإدارية قبل المقابلات", retail: "فرز أعداد كبيرة من المتقدمين قبل وقت فريق التوظيف", logistics: "تقييم المرشحين للوظائف التشغيلية بشكل أسرع وأكثر اتساقا", "financial-services": "توحيد التقييم وإعداد القائمة المختصرة قبل المقابلات", education: "تقييم المتقدمين بشكل موحد بين الأقسام", hospitality: "فرز وتقييم المرشحين للوظائف التشغيلية قبل المقابلات", technology: "التحقق من مهارات المرشحين قبل استهلاك وقت الفريق", other: "فرز وتقييم المرشحين قبل المقابلات", unknown: "فرز وتقييم المرشحين قبل المقابلات" };
  const isEn = locale === "en"; const table = product === "talentera" ? (isEn ? talenteraEn : talenteraAr) : (isEn ? evalifyEn : evalifyAr); return table[bucket] || table.other;
}

export function sequenceTemplate(product: OutreachProduct, locale: RecipientLocale): SequenceTemplate {
  if (product === "evalify") {
    if (locale !== "en") return {
      subject1: "الفرز قبل المقابلات في {company_name}",
      touch1: "هلا {first_name}،\n\n{opening_line}\n\nبما إن عندكم نظام توظيف قائم، غالبا أكبر فرصة للتحسين تكون في {industry_pain}. Evalufy تضيف التقييم والفرز فوق النظام الحالي بدون ما تحتاجون تغيرون نظام التوظيف.\n\nهل تحسين مرحلة الفرز والتقييم ضمن أولوياتكم هالفترة؟",
      subject2: "تقييم المرشحين في {company_name}",
      touch2: "{first_name}، فكرة Evalufy ببساطة إنها تخلي التقييم واحتساب الدرجات وإعداد القائمة المختصرة جزء مرتب قبل المقابلات، مع بقاء نظام التوظيف الحالي كما هو.\n\nهل يناسبكم أشارككم كيف يركب هذا على سير العمل الحالي؟",
      subject3: "أقفل الموضوع؟",
      touch3: "{first_name}، ما ودي أكثر عليك. إذا تحسين الفرز والتقييم مو أولوية الآن أقفل الموضوع، وإذا مناسب أشاركك الفكرة باختصار.",
    };
    return {
      subject1: "Candidate screening at {company_name}",
      touch1: "Hi {first_name},\n\n{opening_line}\n\nSince you already have a recruitment system, the opportunity is often in {industry_pain}. Evalify adds assessments, scoring and screening without replacing the ATS.\n\nIs improving that pre-interview stage a priority this year?",
      subject2: "Assessments before interviews",
      touch2: "Hi {first_name}, Evalify is designed to sit alongside the existing recruitment stack and standardise assessments, scoring and shortlisting before recruiter and hiring-manager time is used.\n\nWorth a quick look at how it could fit the current workflow?",
      subject3: "Close the loop?",
      touch3: "Hi {first_name}, if candidate assessment is not a priority right now, I will close the loop. If it is, happy to share the idea briefly.",
    };
  }
  if (locale !== "en") return {
    subject1: "التوظيف في {company_name}",
    touch1: "هلا {first_name}،\n\n{opening_line}\n\nمع {industry_pain} عادة يزيد الوقت اللي يروح بين الفرز والمقابلات والموافقات والعروض. Talentera تجمع رحلة التوظيف في نظام واحد وتخفف المتابعة اليدوية على الفريق.\n\nهل تطوير هالجزء ضمن أولوياتكم هالفترة؟",
    subject2: "رحلة التوظيف في {company_name}",
    touch2: "{first_name}، كثير من فرق التوظيف يكون عندها خطوات موزعة بين أدوات ومتابعات يدوية. Talentera تربط صفحة الوظائف والفرز والمقابلات والموافقات والعروض في سير عمل أوضح.\n\nهل يناسبكم أشارككم الفكرة بشكل سريع؟",
    subject3: "أقفل الموضوع؟",
    touch3: "{first_name}، ما ودي أكثر عليك. إذا تطوير عملية التوظيف مو أولوية الآن أقفل الموضوع من جهتي، وإذا مناسب أشاركك الفكرة باختصار.",
  };
  return {
    subject1: "Hiring at {company_name}",
    touch1: "Hi {first_name},\n\n{opening_line}\n\nWith {industry_pain}, recruiter time can disappear into moving candidates between screening, interviews, approvals and offers. Talentera brings that journey into one recruitment workflow.\n\nIs improving that flow a priority this year?",
    subject2: "Recruitment flow at {company_name}",
    touch2: "Hi {first_name}, one reason I reached out is that recruitment steps can stay fragmented even when the team has good processes. Talentera connects the career site, screening, interviews, approvals and offers in one workflow.\n\nWorth a quick look?",
    subject3: "Close the loop?",
    touch3: "Hi {first_name}, if improving the recruitment setup is not a priority right now, I will close the loop. If it is, happy to share the idea briefly.",
  };
}

function parseAiJson(content: string) { try { const start = content.indexOf("{"); const end = content.lastIndexOf("}"); if (start < 0 || end <= start) return {}; return object(JSON.parse(content.slice(start, end + 1))); } catch { return {}; } }
async function enrichOneLead(lead: V2Lead, store: IntelligenceStore) {
  const key = intelligenceKey(lead.email, lead.product); const existing = freshIntelligence(store.entries.find((entry) => entry.key === key)); if (existing) return existing;
  const fallback: IntelligenceEntry = { key, locale: lead.locale, greetingName: lead.greetingName, confidence: lead.languageConfidence, reason: lead.languageReason, openingLine: "", updatedAt: new Date().toISOString() };
  if (!aiConfigured()) return fallback;
  try {
    const result = await openRouterCompletion({
      cacheKey: `smartlead-v2-intelligence:${key}:${lead.industryBucket}:${lead.persona}:${lead.detectedAts}`,
      mode: "fast", maxOutputTokens: 180, temperature: 0.1,
      system: [
        "You are a conservative B2B recipient-intelligence checker for GCC cold email.",
        "Return ONLY JSON with locale,greetingName,nameConfidence,nameReason,openingLine.",
        "locale must be ar-SA, ar-GCC, or en.",
        "Do not infer nationality. Use Arabic only when the first name is very clearly an Arabic name/transliteration and the provided country is GCC. Ambiguous international names stay English.",
        "If Arabic, transliterate only the FIRST name to natural Arabic. Never invent or translate a company name.",
        "openingLine must be one short, non-factual, non-creepy sentence based only on industry/persona/product context; no claims that you researched, noticed, saw, verified, or know company activity.",
        "For ar-SA use natural professional Saudi business Arabic, gender-neutral. For en use concise English. No hype, no links, no emojis.",
      ].join(" "),
      user: JSON.stringify({ firstName: lead.firstName, fullName: lead.fullName, country: lead.country, industry: lead.industryBucket, persona: lead.persona, product: lead.product, atsContext: lead.detectedAts || "none visible" }),
    });
    const data = parseAiJson(result.content); const requestedLocale = clean(data.locale) as RecipientLocale; const nameConfidence = Number(data.nameConfidence); const safeArabic = isGccCountry(lead.country) && (requestedLocale === "ar-SA" || requestedLocale === "ar-GCC") && Number.isFinite(nameConfidence) && nameConfidence >= AI_ARABIC_CONFIDENCE && /[\u0600-\u06FF]/.test(clean(data.greetingName));
    const locale: RecipientLocale = safeArabic ? (isKsaCountry(lead.country) ? "ar-SA" : "ar-GCC") : lead.locale;
    const greetingName = safeArabic ? clean(data.greetingName, 60) : lead.greetingName; const confidence = safeArabic ? Math.min(1, nameConfidence) : lead.languageConfidence;
    return { key, locale, greetingName, confidence, reason: safeArabic ? `OpenRouter high-confidence Arabic-name QA: ${clean(data.nameReason, 160)}` : lead.languageReason, openingLine: safeOpeningLineForLocale(clean(data.openingLine), locale), updatedAt: new Date().toISOString() };
  } catch { return fallback; }
}
async function enrichLeads(leads: V2Lead[], store: IntelligenceStore) {
  const results: IntelligenceEntry[] = [];
  for (let index = 0; index < leads.length; index += 8) results.push(...await Promise.all(leads.slice(index, index + 8).map((lead) => enrichOneLead(lead, store))));
  const byKey = new Map(store.entries.map((entry) => [entry.key, entry])); for (const result of results) byKey.set(result.key, result); const updated = { version: 1 as const, entries: [...byKey.values()].slice(-10_000) }; await writeJsonFile(INTELLIGENCE_PATH, updated); return results;
}

function renderPrepared(lead: V2Lead, intelligence: IntelligenceEntry): PreparedV2Lead {
  const locale = intelligence.locale; const template = sequenceTemplate(lead.product, locale); const values = { first_name: intelligence.greetingName || lead.firstName, company_name: lead.companyName, opening_line: intelligence.openingLine, industry_pain: industryPain(lead.industryBucket, locale, lead.product) };
  return {
    ...lead, locale, greetingName: values.first_name, languageConfidence: intelligence.confidence, languageReason: intelligence.reason, nameTranslated: values.first_name !== lead.firstName, openingLine: intelligence.openingLine,
    subject1: sanitizeOutreachText(renderOutreachTemplate(template.subject1, values), 90), touch1: sanitizeOutreachText(renderOutreachTemplate(template.touch1, values), 650),
    subject2: sanitizeOutreachText(renderOutreachTemplate(template.subject2, values), 90), touch2: sanitizeOutreachText(renderOutreachTemplate(template.touch2, values), 520),
    subject3: sanitizeOutreachText(renderOutreachTemplate(template.subject3, values), 90), touch3: sanitizeOutreachText(renderOutreachTemplate(template.touch3, values), 340),
  };
}

function sequencePayload() { return [
  { seq_number: 1, seq_delay_details: { delay_in_days: 0 }, variant_distribution_type: "MANUALLY_EQUAL", variants: [{ subject: "{{sl_subject_1}}", email_body: "{{sl_touch_1}}", variant_label: "A" }] },
  { seq_number: 2, seq_delay_details: { delay_in_days: 4 }, variant_distribution_type: "MANUALLY_EQUAL", variants: [{ subject: "{{sl_subject_2}}", email_body: "{{sl_touch_2}}", variant_label: "A" }] },
  { seq_number: 3, seq_delay_details: { delay_in_days: 6 }, variant_distribution_type: "MANUALLY_EQUAL", variants: [{ subject: "{{sl_subject_3}}", email_body: "{{sl_touch_3}}", variant_label: "A" }] },
]; }
async function configureCampaign(campaign: V2Campaign) {
  await smartleadRequest(`/campaigns/${campaign.id}/settings`, { method: "POST", body: JSON.stringify({ track_settings: ["DONT_TRACK_EMAIL_OPEN", "DONT_TRACK_LINK_CLICK"], stop_lead_settings: "REPLY_TO_AN_EMAIL", unsubscribe_text: "Not relevant? Reply no / غير مناسب؟ رد لا", send_as_plain_text: true, force_plain_text: true, follow_up_percentage: 100, enable_ai_esp_matching: true, auto_pause_domain_leads_on_reply: true, ignore_ss_mailbox_sending_limit: false, bounce_autopause_threshold: "2", domain_level_rate_limit: true, add_unsubscribe_tag: true, out_of_office_detection_settings: { ignoreOOOasReply: false, autoReactivateOOO: false, reactivateOOOwithDelay: 0, autoCategorizeOOO: true }, client_id: null }) });
  await smartleadRequest(`/campaigns/${campaign.id}/schedule`, { method: "POST", body: JSON.stringify({ timezone: "Asia/Riyadh", days_of_the_week: [0, 1, 2, 3, 4], start_hour: process.env.SMARTLEAD_START_HOUR || "09:30", end_hour: process.env.SMARTLEAD_END_HOUR || "16:30", min_time_btw_emails: Math.max(MIN_GAP_MINUTES, positiveInt(process.env.SMARTLEAD_MIN_TIME_BETWEEN_EMAILS, MIN_GAP_MINUTES, 1, 240)), max_new_leads_per_day: campaign.product === "talentera" ? 30 : 20 }) });
  await smartleadRequest(`/campaigns/${campaign.id}/sequences`, { method: "POST", body: JSON.stringify(sequencePayload()) });
}
async function ensureCampaign(product: OutreachProduct) {
  let campaigns = await listCampaigns(); let campaign = currentProductCampaign(product, campaigns);
  if (!campaign) { const created = await smartleadRequest<unknown>("/campaigns/create", { method: "POST", body: JSON.stringify({ name: PRODUCT_CONFIG[product].name, client_id: null }) }); campaign = parseCampaign(created); if (!campaign) { campaigns = await listCampaigns(); campaign = currentProductCampaign(product, campaigns); } }
  if (!campaign) throw new Error(`${PRODUCT_CONFIG[product].brandLabel} campaign could not be created.`); await configureCampaign(campaign); return campaign;
}

function leadPayload(lead: PreparedV2Lead) { return {
  email: lead.email, first_name: lead.greetingName || lead.firstName, last_name: lead.lastName, company_name: lead.companyName, website: lead.domain ? `https://${lead.domain}` : "", location: lead.country, linkedin_profile: lead.linkedinUrl, company_url: lead.domain ? `https://${lead.domain}` : "",
  custom_fields: { sl_subject_1: lead.subject1, sl_touch_1: lead.touch1, sl_subject_2: lead.subject2, sl_touch_2: lead.touch2, sl_subject_3: lead.subject3, sl_touch_3: lead.touch3, sdr_owner: "Marita", hubspot_contact_id: lead.contactId, hubspot_company_id: lead.companyId, locale: lead.locale, greeting_name: lead.greetingName, product: lead.product, industry: lead.industryBucket, persona: lead.persona, ats: lead.detectedAts },
}; }

export async function getSmartleadV2(forceRefresh = false): Promise<SmartleadV2Payload> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.payload;
  const built = await buildQueue(forceRefresh); const senders = await getSenders(built.campaigns);
  const currentRows: Record<OutreachProduct, JsonObject[]> = { talentera: [], evalify: [] };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) currentRows[product] = built.campaigns[product] ? await campaignLeadRows(built.campaigns[product]) : [];
  const [talenteraAnalytics, evalifyAnalytics, prepared] = await Promise.all([analytics(built.campaigns.talentera, currentRows.talentera), analytics(built.campaigns.evalify, currentRows.evalify), readPrepared()]);
  await decorateQueue(built.queue);
  const approvedInventory = validateApprovedSenderInventory(senders); const capacity = capacityPlan(senders); const ready = built.queue.filter((lead) => lead.eligible); const liveCap = globalDailyTarget(); const coverageDays = liveCap ? Math.ceil(ready.length / liveCap * 10) / 10 : 0;
  const payload: SmartleadV2Payload = {
    generatedAt: new Date().toISOString(), configuration: { apiConfigured: Boolean(getApiKey()), openRouterConfigured: aiConfigured(), ownerActionsConfigured: Boolean(clean(process.env.ACQUISITION_OWNER_TOKEN)), maritaOwnerId: MARITA_OWNER_ID, globalDailyNewTarget: globalDailyTarget(), minTimeBetweenEmails: Math.max(MIN_GAP_MINUTES, positiveInt(process.env.SMARTLEAD_MIN_TIME_BETWEEN_EMAILS, MIN_GAP_MINUTES, 1, 240)), maxCampaignEmailsPerMailbox: MAX_CAMPAIGN_EMAILS_PER_MAILBOX },
    safety: { healthy: built.salesSafety.healthy && approvedInventory.healthy, recentSalesActivities: built.salesSafety.activityCount, blockedContacts: built.salesSafety.blockedContactIds.size, blockedCompanies: built.salesSafety.blockedCompanyIds.size, warnings: [...built.salesSafety.warnings, ...approvedInventory.warnings] },
    campaigns: built.campaigns, analytics: { talentera: talenteraAnalytics, evalify: evalifyAnalytics }, senders, capacity,
    summary: { maritaCompanies: built.priority.companies.length, emailCandidates: built.queue.length, ready: ready.length, talenteraReady: ready.filter((lead) => lead.product === "talentera").length, evalifyReady: ready.filter((lead) => lead.product === "evalify").length, blockedBySales: built.queue.filter((lead) => /Sales activity/i.test(lead.blockReason)).length, blockedEmail: built.queue.filter((lead) => /email/i.test(lead.blockReason)).length, alreadyEntered: built.queue.filter((lead) => /Already entered/i.test(lead.blockReason)).length, prepared: prepared?.leads.length ?? 0, today: built.queue.filter((lead) => lead.batchNumber === 1).length, tomorrow: built.queue.filter((lead) => lead.batchNumber === 2).length, next48Hours: built.queue.filter((lead) => lead.batchNumber > 0 && lead.batchNumber <= 2).length, coverageDays },
    queue: built.queue.slice(0, 1_000), preparedSamples: (prepared?.leads ?? []).slice(0, 8), executions: built.executions.slice(0, 500), sequenceCatalog: { talentera: { arSA: sequenceTemplate("talentera", "ar-SA"), en: sequenceTemplate("talentera", "en") }, evalify: { arSA: sequenceTemplate("evalify", "ar-SA"), en: sequenceTemplate("evalify", "en") } },
  };
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload }; return payload;
}

export async function bootstrapSmartleadV2() { const [talentera, evalify] = await Promise.all([ensureCampaign("talentera"), ensureCampaign("evalify")]); cache = null; return { campaigns: { talentera, evalify }, configured: true, activated: false }; }

export async function syncSmartleadV2Senders() {
  const campaigns: Record<OutreachProduct, V2Campaign> = { talentera: await ensureCampaign("talentera"), evalify: await ensureCampaign("evalify") }; const all = await getSenders(campaigns);
  const inventory = validateApprovedSenderInventory(all); if (!inventory.healthy) throw new Error(`Approved sender inventory is not safe: ${inventory.warnings.join(" ")}`);
  const result: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) {
    const ids = all.filter((sender) => sender.eligible && sender.brand === product).map((sender) => sender.id); if (!ids.length) continue;
    await smartleadRequest(`/campaigns/${campaigns[product].id}/email-accounts`, { method: "POST", body: JSON.stringify({ email_account_ids: ids }) }); result[product] = ids.length;
  }
  cache = null; return { attached: result, inventory, note: "Only exact-domain, explicitly connected and warmed senders were attached. Existing V2 campaigns are isolated by product." };
}

export async function analyzeRecipientNames(limit = 100) {
  const built = await buildQueue(true); const leads = built.queue.filter((lead) => lead.eligible && isGccCountry(lead.country)).slice(0, Math.min(250, Math.max(1, limit))); const results = await enrichLeads(leads, built.intelligence); cache = null;
  return { analyzed: results.length, arabic: results.filter((entry) => entry.locale !== "en").length, samples: results.slice(0, 20) };
}

export async function prepareSmartleadV2(limit?: number) {
  const built = await buildQueue(true); if (!built.salesSafety.healthy) throw new Error("Sales safety scan is not healthy. Prepare is locked.");
  const senders = await getSenders(built.campaigns); const inventory = validateApprovedSenderInventory(senders); if (!inventory.healthy) throw new Error(`Approved sender inventory is not safe: ${inventory.warnings.join(" ")}`); const capacity = capacityPlan(senders); if (capacity.liveNewLeadsPerDay < 1) throw new Error("No live sender capacity. Bootstrap campaigns and Sync senders first.");
  const cap = Math.min(capacity.liveNewLeadsPerDay, Math.max(1, positiveInt(limit, capacity.liveNewLeadsPerDay, 1, 150)));
  const productCount: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 }; const selected: V2Lead[] = [];
  for (const lead of built.queue) { if (!lead.eligible) continue; const productCap = capacity.productLiveNewCaps[lead.product]; if (productCount[lead.product] >= productCap) continue; selected.push(lead); productCount[lead.product] += 1; if (selected.length >= cap) break; }
  if (!selected.length) throw new Error("No eligible leads fit the current product sender capacity.");
  const intelligence = await enrichLeads(selected, built.intelligence); const byKey = new Map(intelligence.map((entry) => [entry.key, entry])); const preparedLeads = selected.map((lead) => renderPrepared(lead, byKey.get(intelligenceKey(lead.email, lead.product)) || { key: intelligenceKey(lead.email, lead.product), locale: lead.locale, greetingName: lead.greetingName, confidence: lead.languageConfidence, reason: lead.languageReason, openingLine: "", updatedAt: new Date().toISOString() }));
  await writeJsonFile(PREPARED_PATH, { version: 2, createdAt: new Date().toISOString(), sourceGeneratedAt: built.priority.generatedAt, leads: preparedLeads } satisfies PreparedBatch); cache = null;
  return { prepared: preparedLeads.length, talentera: preparedLeads.filter((lead) => lead.product === "talentera").length, evalify: preparedLeads.filter((lead) => lead.product === "evalify").length, safeNewLeadCap: capacity.liveNewLeadsPerDay, samples: preparedLeads.slice(0, 8) };
}

export async function launchPreparedSmartleadV2() {
  if (process.env.SMARTLEAD_AUTOPILOT_ENABLED !== "true") throw new Error("Sending is locked until SMARTLEAD_AUTOPILOT_ENABLED=true is set after the launch checklist.");
  const prepared = await readPrepared(); if (!prepared?.leads.length) throw new Error("Prepare a V2 batch first."); const built = await buildQueue(true); if (!built.salesSafety.healthy) throw new Error("Sales safety scan is unhealthy. Queue blocked.");
  const campaigns = built.campaigns; const senders = await getSenders(campaigns); const inventory = validateApprovedSenderInventory(senders); if (!inventory.healthy) throw new Error(`Approved sender inventory is not safe: ${inventory.warnings.join(" ")}`); const capacity = capacityPlan(senders); if (capacity.liveNewLeadsPerDay < 1) throw new Error("No safe sender capacity.");
  const fresh = new Map(built.queue.filter((lead) => lead.eligible).map((lead) => [lead.email.toLowerCase(), lead])); const safe = prepared.leads.filter((lead) => { const current = fresh.get(lead.email.toLowerCase()); return current && current.contactId === lead.contactId && current.companyId === lead.companyId && current.product === lead.product; }).slice(0, capacity.liveNewLeadsPerDay);
  if (!safe.length) throw new Error("Every prepared lead failed the fresh safety/product check.");
  const ledger = await readLedger(); const existingLedger = new Set(ledger.entries.map((entry) => entry.email.toLowerCase())); const newLedger: LedgerEntry[] = []; const results: Record<OutreachProduct, unknown[]> = { talentera: [], evalify: [] };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) {
    const campaign = campaigns[product]; const productLeads = safe.filter((lead) => lead.product === product && !existingLedger.has(lead.email.toLowerCase())); if (!productLeads.length) continue; if (!campaign) throw new Error(`${PRODUCT_CONFIG[product].brandLabel} V2 campaign is missing.`);
    const assigned = await campaignSenderIds(campaign); if (!assigned.size) throw new Error(`${PRODUCT_CONFIG[product].brandLabel} campaign has no attached senders.`);
    for (let index = 0; index < productLeads.length; index += 400) {
      const chunk = productLeads.slice(index, index + 400); const response = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/leads`, { method: "POST", body: JSON.stringify({ lead_list: chunk.map(leadPayload), settings: { ignore_global_block_list: false, ignore_unsubscribe_list: false, ignore_community_bounce_list: false, ignore_duplicate_leads_in_other_campaign: false } }) }); results[product].push(response);
      for (const lead of chunk) newLedger.push({ email: lead.email, contactId: lead.contactId, companyId: lead.companyId, product, campaignId: campaign.id, queuedAt: new Date().toISOString(), lastKnownStatus: "QUEUED" });
    }
  }
  await writeJsonFile(LEDGER_PATH, { version: 1, entries: [...ledger.entries, ...newLedger].slice(-50_000) } satisfies Ledger); await writeJsonFile(PREPARED_PATH, { version: 2, createdAt: new Date().toISOString(), sourceGeneratedAt: prepared.sourceGeneratedAt, leads: [] } satisfies PreparedBatch); cache = null;
  return { requested: prepared.leads.length, queued: newLedger.length, talentera: newLedger.filter((entry) => entry.product === "talentera").length, evalify: newLedger.filter((entry) => entry.product === "evalify").length, skippedByFreshSafetyOrDedupe: prepared.leads.length - newLedger.length, responses: results };
}

export async function setSmartleadV2Status(product: OutreachProduct | "all", status: "START" | "PAUSED") {
  if (status === "START" && process.env.SMARTLEAD_AUTOPILOT_ENABLED !== "true") throw new Error("Starting campaigns is locked until SMARTLEAD_AUTOPILOT_ENABLED=true is set after the launch checklist.");
  const campaigns = await listCampaigns(); const products: OutreachProduct[] = product === "all" ? ["talentera", "evalify"] : [product]; const updated: Record<string, string> = {};
  const senders = status === "START" ? await getSenders({ talentera: currentProductCampaign("talentera", campaigns), evalify: currentProductCampaign("evalify", campaigns) }) : [];
  if (status === "START") { const inventory = validateApprovedSenderInventory(senders); if (!inventory.healthy) throw new Error(`Approved sender inventory is not safe: ${inventory.warnings.join(" ")}`); }
  for (const key of products) { const campaign = currentProductCampaign(key, campaigns); if (!campaign) throw new Error(`${PRODUCT_CONFIG[key].brandLabel} V2 campaign is missing.`); if (status === "START") { const ids = await campaignSenderIds(campaign); const safeIds = new Set(senders.filter((sender) => sender.eligible && sender.brand === key).map((sender) => sender.id)); if (ids.size !== safeIds.size || [...ids].some((id) => !safeIds.has(id))) throw new Error(`${PRODUCT_CONFIG[key].brandLabel} has a missing or unsafe sender attachment.`); } await smartleadRequest(`/campaigns/${campaign.id}/status`, { method: "POST", body: JSON.stringify({ status }) }); updated[key] = status; }
  cache = null; return { updated };
}
