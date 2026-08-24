import { timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { openRouterCompletion } from "@/lib/openrouter-low-cost";
import { runOutreachEmailWaterfall } from "@/lib/outreach-email-waterfall";
import {
  isGccCountry,
  isKsaCountry,
  type OutreachProduct,
  type RecipientLocale,
} from "@/lib/recipient-language-routing";
import { getSmartleadSalesSafetySnapshot, getSmartleadV2, type V2Lead } from "@/lib/smartlead-v2";
import { safeOpeningLineForLocale } from "@/lib/smartlead-policy";
import { checkPrimeforgeInfrastructure } from "@/lib/primeforge-health";
import {
  buildDailyLaneTargets,
  DAILY_LANE_NEW_CAPS,
  selectVerifiedDailyBatch,
  verificationCandidatesForLane,
} from "@/lib/smartlead-daily-routing";
import {
  VISIBLE_SEQUENCE_LANES,
  laneFor,
  smartleadSequencePayload,
  type OutreachLane,
} from "@/lib/smartlead-visible-sequences";
import { inspectSenderAccount, validateApprovedSenderInventory } from "@/lib/smartlead-sender-routing";
import { ensureMillionVerifierStatusProperty } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
const GLOBAL_NEW_LEADS_PER_DAY = 50;
const MAX_CAMPAIGN_EMAILS_PER_MAILBOX = 20;
const PEAK_TOUCH_MULTIPLIER = 5;
const CAPACITY_SAFETY_FACTOR = 0.85;
const MIN_GAP_MINUTES = 15;
const AI_ARABIC_CONFIDENCE = 0.97;
const VERIFICATION_BUFFER = 10;
const STATE_PATH = process.env.SMARTLEAD_AUTOPILOT_STATE_PATH || "/app/data/smartlead-v2-autopilot.json";
const LEDGER_PATH = process.env.SMARTLEAD_V2_LEDGER_PATH || "/app/data/smartlead-v2-ledger.json";
const BUSINESS_DAYS = new Set(["Sun", "Mon", "Tue", "Wed", "Thu"]);
const BOUNCE_GUARD_MIN_SENT = 50;
const BOUNCE_GUARD_RATE = 0.02;
const LANES = Object.keys(VISIBLE_SEQUENCE_LANES) as OutreachLane[];
const MANAGED_CAMPAIGN_NAMES = new Set(LANES.map((lane) => VISIBLE_SEQUENCE_LANES[lane].campaignName));

type JsonObject = Record<string, unknown>;
type Campaign = { id: number; name: string; status: string };
type LegacyCampaign = Campaign & { activeLeads: number; action: "blocked_active" | "paused" | "already_paused" | "pause_failed" };
type Sender = { id: number; email: string; brand: OutreachProduct | "unknown"; capacity: number; eligible: boolean; reasons: string[] };
type LedgerEntry = { email: string; contactId: string; companyId: string; product: OutreachProduct; campaignId: number; queuedAt: string; lastKnownStatus: string };
type Ledger = { version: 1; entries: LedgerEntry[] };
type PreparedLead = V2Lead & { openingLine: string };
type AutopilotState = {
  version: 1;
  status: "never" | "running" | "success" | "noop" | "blocked" | "failed";
  riyadhDate: string;
  startedAt: string;
  finishedAt: string;
  lastSuccessfulDate: string;
  prepared: number;
  queued: number;
  talentera: number;
  evalufy: number;
  message: string;
  warnings: string[];
};

const EMPTY_STATE: AutopilotState = {
  version: 1,
  status: "never",
  riyadhDate: "",
  startedAt: "",
  finishedAt: "",
  lastSuccessfulDate: "",
  prepared: 0,
  queued: 0,
  talentera: 0,
  evalufy: 0,
  message: "Visible-sequence Smartlead orchestrator has not run yet.",
  warnings: [],
};

function clean(value: unknown, max = 4_000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function list(value: unknown, keys: string[] = []) { if (Array.isArray(value)) return value; const item = object(value); for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[]; return [] as unknown[]; }
function numberFrom(value: unknown, keys: string[]) { const item = object(value); for (const key of keys) { const parsed = Number(item[key]); if (Number.isFinite(parsed)) return parsed; } return 0; }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function apiKey() { return clean(process.env.SMARTLEAD_API_KEY, 8_000); }
function autopilotEnabled() { return process.env.SMARTLEAD_AUTOPILOT_ENABLED === "true"; }
function authorized(request: NextRequest) { const supplied = clean(request.headers.get("authorization"), 8_000).replace(/^Bearer\s+/i, ""); const expected = apiKey(); return Boolean(expected && supplied && safeEqual(supplied, expected)); }

function riyadhClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, weekday: value("weekday") };
}

async function readJson<T>(file: string, fallback: T): Promise<T> { try { return JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file, "utf8")) as T; } catch { return fallback; } }
async function writeJson(file: string, value: unknown) { await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true }); const tmp = `${file}.tmp-${process.pid}`; await fs.writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 }); await fs.rename(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ file); }
async function readState() { return readJson<AutopilotState>(STATE_PATH, { ...EMPTY_STATE }); }
async function readLedger() { return readJson<Ledger>(LEDGER_PATH, { version: 1, entries: [] }); }

async function smartleadRequest<T>(endpoint: string, init: RequestInit = {}, extraQuery: Record<string, string> = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("SMARTLEAD_API_KEY is not configured.");
  const query = new URLSearchParams({ api_key: key, ...extraQuery });
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${SMARTLEAD_API}${endpoint}?${query.toString()}`, {
        ...init,
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) { if (response.status === 204) return undefined as T; return await response.json() as T; }
      const body = (await response.text()).slice(0, 800);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) { await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt)); continue; }
      throw new Error(`Smartlead API ${endpoint} failed (${response.status}): ${body}`);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Smartlead API request failed.");
}

function parseCampaign(value: unknown): Campaign | null {
  const item = object(value); const id = Number(item.id); const name = clean(item.name); if (!Number.isFinite(id) || !name) return null;
  return { id, name, status: clean(item.status) || "UNKNOWN" };
}

async function listCampaigns() {
  const payload = await smartleadRequest<unknown>("/campaigns/", { method: "GET" }, { include_tags: "true" });
  return list(payload, ["campaigns", "data"]).map(parseCampaign).filter((item): item is Campaign => Boolean(item));
}

function isMaritaOutreachCampaignName(name: string) {
  return /Marita\s+SDR/i.test(name) && /Talentera|Eval(?:u|i)?fy/i.test(name);
}

async function pauseManagedCampaigns() {
  const campaigns = (await listCampaigns()).filter((campaign) => isMaritaOutreachCampaignName(campaign.name));
  let paused = 0;
  for (const campaign of campaigns) {
    if (/pause|stop/i.test(campaign.status)) continue;
    await smartleadRequest(`/campaigns/${campaign.id}/status`, { method: "POST", body: JSON.stringify({ status: "PAUSED" }) });
    paused += 1;
  }
  return paused;
}

async function configureCampaign(lane: OutreachLane, campaign: Campaign) {
  const language = VISIBLE_SEQUENCE_LANES[lane].language;
  await smartleadRequest(`/campaigns/${campaign.id}/settings`, {
    method: "POST",
    body: JSON.stringify({
      track_settings: ["DONT_TRACK_EMAIL_OPEN", "DONT_TRACK_LINK_CLICK"],
      stop_lead_settings: "REPLY_TO_AN_EMAIL",
      unsubscribe_text: language === "ar" ? "غير مناسب؟ رد لا" : "Not relevant? Reply no",
      send_as_plain_text: true,
      force_plain_text: true,
      follow_up_percentage: 100,
      enable_ai_esp_matching: true,
      auto_pause_domain_leads_on_reply: true,
      ignore_ss_mailbox_sending_limit: false,
      bounce_autopause_threshold: "2",
      domain_level_rate_limit: true,
      add_unsubscribe_tag: true,
      out_of_office_detection_settings: {
        ignoreOOOasReply: false,
        autoReactivateOOO: false,
        reactivateOOOwithDelay: 0,
        autoCategorizeOOO: true,
      },
      client_id: null,
    }),
  });
  await smartleadRequest(`/campaigns/${campaign.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({
      timezone: "Asia/Riyadh",
      days_of_the_week: [0, 1, 2, 3, 4],
      start_hour: "09:30",
      end_hour: "16:30",
      min_time_btw_emails: MIN_GAP_MINUTES,
      max_new_leads_per_day: DAILY_LANE_NEW_CAPS[lane],
    }),
  });
  await smartleadRequest(`/campaigns/${campaign.id}/sequences`, {
    method: "POST",
    body: JSON.stringify(smartleadSequencePayload(lane)),
  });
}

async function ensureCampaign(lane: OutreachLane) {
  const definition = VISIBLE_SEQUENCE_LANES[lane];
  let campaigns = await listCampaigns();
  let campaign = campaigns.find((item) => item.name === definition.campaignName) ?? null;
  if (!campaign) {
    const created = await smartleadRequest<unknown>("/campaigns/create", { method: "POST", body: JSON.stringify({ name: definition.campaignName, client_id: null }) });
    campaign = parseCampaign(created);
    if (!campaign) { campaigns = await listCampaigns(); campaign = campaigns.find((item) => item.name === definition.campaignName) ?? null; }
  }
  if (!campaign) throw new Error(`${definition.label} campaign could not be created.`);
  await configureCampaign(lane, campaign);
  return campaign;
}

async function listEmailAccounts() {
  const rows: unknown[] = [];
  for (let offset = 0; offset < 5_000; offset += 100) {
    const payload = await smartleadRequest<unknown>("/email-accounts/", { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(payload, ["email_accounts", "data", "accounts"]); rows.push(...batch); if (batch.length < 100) break;
  }
  return rows;
}

function parseSender(value: unknown): Sender | null {
  const item = object(value); const id = Number(item.id ?? item.email_account_id); if (!Number.isFinite(id)) return null;
  const safety = inspectSenderAccount(item, MAX_CAMPAIGN_EMAILS_PER_MAILBOX);
  return { id, email: safety.email, brand: safety.brand, capacity: safety.capacity, eligible: safety.eligible, reasons: safety.reasons };
}

async function syncSenders(campaigns: Record<OutreachLane, Campaign>, senders: Sender[]) {
  const attached = {} as Record<OutreachLane, number>;
  for (const lane of LANES) {
    const product = VISIBLE_SEQUENCE_LANES[lane].product;
    const ids = senders.filter((sender) => sender.eligible && sender.brand === product).map((sender) => sender.id);
    if (ids.length) await smartleadRequest(`/campaigns/${campaigns[lane].id}/email-accounts`, { method: "POST", body: JSON.stringify({ email_account_ids: ids }) });
    attached[lane] = ids.length;
  }
  return { senders, attached };
}

function capacityPlan(senders: Sender[]) {
  const productCaps: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  const productEmailCapacity: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) {
    const dailyEmails = senders.filter((sender) => sender.eligible && sender.brand === product).reduce((sum, sender) => sum + sender.capacity, 0);
    productEmailCapacity[product] = dailyEmails;
    productCaps[product] = Math.floor((dailyEmails / PEAK_TOUCH_MULTIPLIER) * CAPACITY_SAFETY_FACTOR);
  }
  const globalSafeNew = Math.min(GLOBAL_NEW_LEADS_PER_DAY, productCaps.talentera + productCaps.evalify);
  return { productCaps, productEmailCapacity, globalSafeNew, peakTouchMultiplier: PEAK_TOUCH_MULTIPLIER, safetyFactor: CAPACITY_SAFETY_FACTOR };
}

async function campaignAnalytics(campaign: Campaign) {
  const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/analytics`, { method: "GET" });
  const leadRows: JsonObject[] = [];
  for (let offset = 0; offset < 20_000; offset += 100) {
    const leadPayload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/leads`, { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(leadPayload, ["leads", "data", "results"]).map(object);
    leadRows.push(...batch);
    if (batch.length < 100) break;
  }
  const sent = numberFrom(payload, ["sent_count", "sent", "total_sent", "emails_sent"]); const bounces = numberFrom(payload, ["bounce_count", "bounces", "total_bounces"]);
  const spamComplaints = leadRows.filter((row) => Boolean(row.is_spam) || /(?:^|[_ -])spam(?:$|[_ -])/i.test(clean(row.status || row.lead_status || row.email_status || row.category))).length;
  return { sent, bounces, bounceRate: sent ? bounces / sent : 0, spamComplaints, spamRate: sent ? spamComplaints / sent : 0, replies: numberFrom(payload, ["reply_count", "replies", "total_replies"]) };
}

async function freshHealthySnapshot(context: string) {
  let lastWarning = "Unknown HubSpot or sender-inventory safety warning.";
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      const snapshot = await getSmartleadV2(true);
      if (snapshot.safety.healthy) return snapshot;
      lastWarning = snapshot.safety.warnings.filter(Boolean).join(" ") || lastWarning;
    } catch (error) {
      lastWarning = error instanceof Error ? error.message : lastWarning;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_500 * 2 ** attempt));
  }
  throw new Error(`${context}; queue aborted after safety retries. ${lastWarning}`);
}

function inactiveLead(row: JsonObject) {
  return /complete|stopp|paus|unsub|bounce|repl/i.test(clean(row.status || row.lead_status || row.email_status || row.category));
}

async function campaignLeadRows(campaign: Campaign) {
  const rows: JsonObject[] = [];
  for (let offset = 0; offset < 20_000; offset += 100) {
    const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/leads`, { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(payload, ["leads", "data", "results"]).map(object);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

async function activeCampaignLeadCount(campaign: Campaign) {
  return (await campaignLeadRows(campaign)).filter((row) => !inactiveLead(row)).length;
}

async function pauseSalesProtectedLeads(campaigns: Record<OutreachLane, Campaign>) {
  const safety = await getSmartleadSalesSafetySnapshot();
  if (!safety.healthy) throw new Error(`HubSpot Sales safety sync failed: ${safety.warnings.join(" ")}`);
  const blockedContacts = new Set(safety.blockedContactIds);
  const blockedCompanies = new Set(safety.blockedCompanyIds);
  const ledger = await readLedger();
  const ledgerByCampaignEmail = new Map(ledger.entries.map((entry) => [`${entry.campaignId}|${entry.email.toLowerCase()}`, entry]));
  const pausedEmails = new Set<string>();
  let paused = 0;

  for (const lane of LANES) {
    const campaign = campaigns[lane];
    for (const row of await campaignLeadRows(campaign)) {
      if (inactiveLead(row)) continue;
      const nestedLead = object(row.lead);
      const custom = object(row.custom_fields || nestedLead.custom_fields);
      const email = clean(row.email || nestedLead.email).toLowerCase();
      const ledgerEntry = ledgerByCampaignEmail.get(`${campaign.id}|${email}`);
      const contactId = clean(custom.hubspot_contact_id || row.hubspot_contact_id || ledgerEntry?.contactId);
      const companyId = clean(custom.hubspot_company_id || row.hubspot_company_id || ledgerEntry?.companyId);
      if (!blockedContacts.has(contactId) && !blockedCompanies.has(companyId)) continue;
      const leadId = Number(row.id ?? row.lead_id ?? nestedLead.id);
      if (!Number.isFinite(leadId)) throw new Error(`${VISIBLE_SEQUENCE_LANES[lane].label} contains a Sales-protected active lead without a resolvable Smartlead lead ID.`);
      await smartleadRequest(`/campaigns/${campaign.id}/leads/${leadId}/pause`, { method: "POST" });
      paused += 1;
      if (email) pausedEmails.add(email);
    }
  }

  if (pausedEmails.size) {
    await writeJson(LEDGER_PATH, { version: 1, entries: ledger.entries.map((entry) => pausedEmails.has(entry.email.toLowerCase()) ? { ...entry, lastKnownStatus: "PAUSED_SALES_ACTIVITY" } : entry) } satisfies Ledger);
  }
  return { paused, activityCount: safety.activityCount };
}

async function legacySafety() {
  const all = await listCampaigns(); const warnings: string[] = []; const campaigns: LegacyCampaign[] = [];
  for (const campaign of all.filter((item) => isMaritaOutreachCampaignName(item.name) && !MANAGED_CAMPAIGN_NAMES.has(item.name))) {
    const activeLeads = await activeCampaignLeadCount(campaign);
    if (activeLeads > 0) {
      warnings.push(`${campaign.name} contains ${activeLeads} active lead(s); visible-sequence autopilot is locked to avoid double sending.`);
      campaigns.push({ ...campaign, activeLeads, action: "blocked_active" });
      continue;
    }
    if (/pause|stop/i.test(campaign.status)) {
      campaigns.push({ ...campaign, activeLeads, action: "already_paused" });
      continue;
    }
    try {
      await smartleadRequest(`/campaigns/${campaign.id}/status`, { method: "POST", body: JSON.stringify({ status: "PAUSED" }) });
      campaigns.push({ ...campaign, status: "PAUSED", activeLeads, action: "paused" });
    } catch {
      warnings.push(`${campaign.name} has no active leads but could not be paused; autopilot remains locked.`);
      campaigns.push({ ...campaign, activeLeads, action: "pause_failed" });
    }
  }
  return { warnings, campaigns };
}

function painFor(lead: V2Lead, locale: RecipientLocale) {
  const ar = locale !== "en"; const bucket = lead.industryBucket;
  if (lead.product === "evalify") {
    const en: Record<string, string> = { healthcare: "screening clinical and non-clinical candidates consistently", retail: "screening high applicant volumes", logistics: "assessing operational candidates consistently", "financial-services": "standardising assessments and shortlisting", education: "screening applicants across departments", hospitality: "assessing high-volume operational applicants", technology: "validating specialist skills before interviews", other: "screening and assessing candidates before interviews", unknown: "screening and assessing candidates before interviews" };
    const arMap: Record<string, string> = { healthcare: "فرز وتقييم المرشحين للوظائف الطبية والإدارية", retail: "فرز أعداد كبيرة من المتقدمين", logistics: "تقييم المرشحين للوظائف التشغيلية", "financial-services": "توحيد التقييم وإعداد القائمة المختصرة", education: "تقييم المتقدمين بين الأقسام", hospitality: "فرز وتقييم المرشحين للوظائف التشغيلية", technology: "التحقق من مهارات المرشحين قبل المقابلات", other: "فرز وتقييم المرشحين قبل المقابلات", unknown: "فرز وتقييم المرشحين قبل المقابلات" };
    return (ar ? arMap : en)[bucket] || (ar ? arMap.other : en.other);
  }
  const en: Record<string, string> = { healthcare: "clinical and non-clinical hiring across teams", retail: "high-volume frontline hiring across locations", logistics: "operational and warehouse hiring", "financial-services": "structured hiring with multiple approvals", education: "seasonal hiring across departments", hospitality: "high-volume operational hiring across locations", technology: "specialist hiring with less recruiter admin", other: "screening, interviews, approvals and offers", unknown: "screening, interviews, approvals and offers" };
  const arMap: Record<string, string> = { healthcare: "التوظيف للوظائف الطبية والإدارية مع تعدد الفرق", retail: "التوظيف التشغيلي للفروع وأعداد المرشحين الكبيرة", logistics: "التوظيف التشغيلي والمستودعات", "financial-services": "تنظيم مراحل التوظيف والموافقات", education: "التوظيف الموسمي وتعدد الأقسام", hospitality: "التوظيف التشغيلي لعدة مواقع", technology: "توظيف الكفاءات المتخصصة وتقليل العمل اليدوي", other: "ربط الفرز والمقابلات والموافقات والعروض", unknown: "ربط الفرز والمقابلات والموافقات والعروض" };
  return (ar ? arMap : en)[bucket] || (ar ? arMap.other : en.other);
}

function parseAiJson(content: string) { try { const start = content.indexOf("{"); const end = content.lastIndexOf("}"); if (start < 0 || end <= start) return {}; return object(JSON.parse(content.slice(start, end + 1))); } catch { return {}; } }

async function personalizeLead(lead: V2Lead): Promise<PreparedLead> {
  let locale = lead.locale; let greetingName = lead.greetingName || lead.firstName; let openingLine = "";
  try {
    const result = await openRouterCompletion({
      cacheKey: `smartlead-visible:${lead.email}:${lead.product}:${lead.industryBucket}:${lead.persona}:${lead.detectedAts}`,
      mode: "fast", maxOutputTokens: 180, temperature: 0.1,
      system: [
        "You are a conservative GCC B2B cold-email recipient-intelligence checker.",
        "Return ONLY JSON with locale,greetingName,nameConfidence,openingLine.",
        "locale must be ar-SA, ar-GCC, or en.",
        "Never infer nationality. Arabic is allowed only when the first name is clearly Arabic and the person is in GCC. Ambiguous names stay English.",
        "openingLine must be one short, non-creepy sentence based only on industry/persona/product context.",
        "Never claim you researched, saw, noticed, verified or know company activity. No links, emojis, hype, fake metrics or unsupported claims.",
      ].join(" "),
      user: JSON.stringify({ firstName: lead.firstName, fullName: lead.fullName, country: lead.country, industry: lead.industryBucket, persona: lead.persona, product: lead.product === "evalify" ? "Evalufy" : "Talentera", ats: lead.detectedAts || "none visible" }),
    });
    const data = parseAiJson(result.content); const requestedLocale = clean(data.locale) as RecipientLocale; const confidence = Number(data.nameConfidence); const candidateName = clean(data.greetingName, 60);
    const safeArabic = isGccCountry(lead.country) && (requestedLocale === "ar-SA" || requestedLocale === "ar-GCC") && Number.isFinite(confidence) && confidence >= AI_ARABIC_CONFIDENCE && /[\u0600-\u06FF]/.test(candidateName);
    if (safeArabic) { locale = isKsaCountry(lead.country) ? "ar-SA" : "ar-GCC"; greetingName = candidateName; }
    openingLine = safeOpeningLineForLocale(clean(data.openingLine, 220), locale);
  } catch { openingLine = ""; }
  return { ...lead, locale, greetingName, nameTranslated: greetingName !== lead.firstName, openingLine };
}

async function personalizeBatch(leads: V2Lead[]) {
  const results: PreparedLead[] = [];
  for (let index = 0; index < leads.length; index += 6) results.push(...await Promise.all(leads.slice(index, index + 6).map(personalizeLead)));
  return results;
}

function leadPayload(lead: PreparedLead) {
  return {
    email: lead.email,
    first_name: lead.greetingName || lead.firstName,
    last_name: lead.lastName,
    company_name: lead.companyName,
    website: lead.domain ? `https://${lead.domain}` : "",
    location: lead.country,
    linkedin_profile: lead.linkedinUrl,
    company_url: lead.domain ? `https://${lead.domain}` : "",
    custom_fields: {
      opening_line: lead.openingLine,
      industry_pain: painFor(lead, lead.locale),
      sdr_owner: "Marita",
      hubspot_contact_id: lead.contactId,
      hubspot_company_id: lead.companyId,
      locale: lead.locale,
      greeting_name: lead.greetingName,
      product: lead.product === "evalify" ? "Evalufy" : "Talentera",
      industry: lead.industryBucket,
      persona: lead.persona,
      ats: lead.detectedAts,
    },
  };
}

async function setupOnly() {
  const killSwitchPaused = autopilotEnabled() ? 0 : await pauseManagedCampaigns();
  let millionVerifierProperty: Awaited<ReturnType<typeof ensureMillionVerifierStatusProperty>> | null = null;
  let millionVerifierPropertyWarning = "";
  try {
    millionVerifierProperty = await ensureMillionVerifierStatusProperty();
  } catch (error) {
    millionVerifierPropertyWarning = error instanceof Error
      ? error.message
      : "MillionVerifier property reconciliation failed.";
  }
  let primeforge: Awaited<ReturnType<typeof checkPrimeforgeInfrastructure>> | null = null;
  let primeforgeWarnings: string[] = [];
  try {
    primeforge = await checkPrimeforgeInfrastructure();
    if (!primeforge.healthy) primeforgeWarnings = primeforge.warnings;
  } catch (error) {
    primeforgeWarnings = [error instanceof Error ? error.message : "Primeforge advisory check failed."];
  }
  const senders = (await listEmailAccounts()).map(parseSender).filter((item): item is Sender => Boolean(item));
  const inventory = validateApprovedSenderInventory(senders);
  if (!inventory.healthy) throw new Error(`Approved sender inventory is not safe: ${inventory.warnings.join(" ")}`);
  const pairs = await Promise.all(LANES.map(async (lane) => [lane, await ensureCampaign(lane)] as const));
  const campaigns = Object.fromEntries(pairs) as Record<OutreachLane, Campaign>;
  const senderSync = await syncSenders(campaigns, senders); const capacity = capacityPlan(senderSync.senders); const legacy = await legacySafety();
  return {
    ok: true,
    mode: "setup",
    activated: false,
    queued: 0,
    campaigns: Object.fromEntries(LANES.map((lane) => [lane, { id: campaigns[lane].id, name: campaigns[lane].name, status: campaigns[lane].status }])),
    campaignTopology: { managedVisible: LANES.length, legacyDetected: legacy.campaigns.length, totalMaritaOutreach: LANES.length + legacy.campaigns.length },
    sequences: Object.fromEntries(LANES.map((lane) => [lane, VISIBLE_SEQUENCE_LANES[lane].touches])),
    sequenceTiming: { touch1: "Day 1", touch2: "+4 days", touch3: "+6 days after Touch 2 (~Day 11)", stopOnReply: true, plainText: true, tracking: "off" },
    sendWindow: { timezone: "Asia/Riyadh", days: "Sunday-Thursday", hours: "09:30-16:30", minimumGapMinutes: MIN_GAP_MINUTES },
    dailyLaneNewCaps: DAILY_LANE_NEW_CAPS,
    senders: senderSync.attached,
    inventory,
    primeforge,
    primeforgeGateEnforced: false,
    primeforgeWarnings,
    millionVerifierProperty,
    millionVerifierPropertyWarning,
    killSwitchPaused,
    capacity,
    legacyWarnings: legacy.warnings,
    legacyCampaigns: legacy.campaigns,
  };
}

async function autopilot(millionVerifierApiKey = "") {
  const clock = riyadhClock(); const previous = await readState();
  if (!autopilotEnabled()) {
    const pausedCampaigns = await pauseManagedCampaigns();
    return { ok: true, skipped: true, blocked: true, pausedCampaigns, reason: "Autopilot is disabled; managed campaigns were confirmed paused.", state: previous };
  }
  if (!BUSINESS_DAYS.has(clock.weekday)) return { ok: true, skipped: true, reason: "KSA weekend; no new cold outreach is queued.", state: previous };
  if (previous.lastSuccessfulDate === clock.date && ["success", "noop"].includes(previous.status)) return { ok: true, skipped: true, reason: "Today's batch was already processed successfully.", state: previous };

  const startedAt = new Date().toISOString();
  await writeJson(STATE_PATH, { ...EMPTY_STATE, status: "running", riyadhDate: clock.date, startedAt, lastSuccessfulDate: previous.lastSuccessfulDate, message: "Running verified visible-sequence Smartlead autopilot." } satisfies AutopilotState);

  try {
    const setup = await setupOnly();
    if (setup.legacyWarnings.length) {
      const state: AutopilotState = { ...EMPTY_STATE, status: "blocked", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: previous.lastSuccessfulDate, message: "Legacy Smartlead campaign still has active leads; new lane autopilot is locked.", warnings: setup.legacyWarnings };
      await writeJson(STATE_PATH, state); return { ok: true, blocked: true, state, warnings: setup.legacyWarnings };
    }
    const campaigns = Object.fromEntries(LANES.map((lane) => [lane, { ...(setup.campaigns[lane] as { id: number; name: string }), status: "" }])) as Record<OutreachLane, Campaign>;
    const salesActivitySync = await pauseSalesProtectedLeads(campaigns);
    const senderRows = (await listEmailAccounts()).map(parseSender).filter((item): item is Sender => Boolean(item)); const capacity = capacityPlan(senderRows);
    if (capacity.globalSafeNew < 1) throw new Error("No safe brand-matched sender capacity is available.");

    const analytics = {} as Record<OutreachLane, Awaited<ReturnType<typeof campaignAnalytics>>>;
    const reputationWarnings: string[] = [];
    for (const lane of LANES) {
      analytics[lane] = await campaignAnalytics(campaigns[lane]);
      if (analytics[lane].sent >= BOUNCE_GUARD_MIN_SENT && analytics[lane].bounceRate >= BOUNCE_GUARD_RATE) reputationWarnings.push(`${VISIBLE_SEQUENCE_LANES[lane].label} bounce rate is ${(analytics[lane].bounceRate * 100).toFixed(1)}% after ${analytics[lane].sent} sends (2% guardrail).`);
      if (analytics[lane].spamComplaints > 0) reputationWarnings.push(`${VISIBLE_SEQUENCE_LANES[lane].label} has ${analytics[lane].spamComplaints} recorded spam complaint(s); zero-complaint guardrail engaged.`);
    }
    if (reputationWarnings.length) {
      const pausedCampaigns = await pauseManagedCampaigns();
      const state: AutopilotState = { ...EMPTY_STATE, status: "blocked", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: previous.lastSuccessfulDate, message: "Reputation guard blocked new outreach.", warnings: reputationWarnings };
      await writeJson(STATE_PATH, state); return { ok: true, blocked: true, pausedCampaigns, state, warnings: reputationWarnings };
    }

    let snapshot = await getSmartleadV2(true);
    if (!snapshot.safety.healthy) {
      const pausedCampaigns = await pauseManagedCampaigns();
      const state: AutopilotState = { ...EMPTY_STATE, status: "blocked", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: previous.lastSuccessfulDate, message: "HubSpot Sales safety is not healthy; no lead was queued.", warnings: snapshot.safety.warnings };
      await writeJson(STATE_PATH, state); return { ok: true, blocked: true, pausedCampaigns, state, warnings: snapshot.safety.warnings };
    }
    const laneTargets = buildDailyLaneTargets(capacity.globalSafeNew, capacity.productCaps, DAILY_LANE_NEW_CAPS);
    const targetTotal = LANES.reduce((sum, lane) => sum + laneTargets[lane], 0);
    type VerificationResult = Awaited<ReturnType<typeof runOutreachEmailWaterfall>>;
    const verificationByLane: Partial<Record<OutreachLane, VerificationResult>> = {};
    const verifiedEmails = new Set<string>();
    for (const lane of LANES) {
      const target = laneTargets[lane];
      if (target < 1) continue;
      const laneBuffer = Math.max(2, Math.ceil(VERIFICATION_BUFFER * target / Math.max(1, targetTotal)));
      const candidates = verificationCandidatesForLane(snapshot.queue, lane);
      const result = await runOutreachEmailWaterfall(candidates, target, { millionVerifierApiKey, buffer: laneBuffer });
      verificationByLane[lane] = result;
      for (const email of result.sendableEmails) verifiedEmails.add(email.toLowerCase());
    }
    const verificationResults = Object.values(verificationByLane);
    const verification = {
      provider: "MillionVerifier",
      fallback: "SignalHire work email, re-verified by MillionVerifier",
      policy: "valid-only",
      target: targetTotal,
      considered: verificationResults.reduce((sum, result) => sum + result.considered, 0),
      millionVerifierChecks: verificationResults.reduce((sum, result) => sum + result.millionVerifierChecks, 0),
      millionVerifierCacheHits: verificationResults.reduce((sum, result) => sum + result.millionVerifierCacheHits, 0),
      signalHireLookups: verificationResults.reduce((sum, result) => sum + result.signalHireLookups, 0),
      replacements: verificationResults.reduce((sum, result) => sum + result.replacements, 0),
      validCurrent: verificationResults.reduce((sum, result) => sum + result.validCurrent, 0),
      noValidEmail: verificationResults.reduce((sum, result) => sum + result.noValidEmail, 0),
      errors: verificationResults.reduce((sum, result) => sum + result.errors, 0),
      sendable: verifiedEmails.size,
      lanes: Object.fromEntries(LANES.map((lane) => [lane, {
        target: laneTargets[lane],
        considered: verificationByLane[lane]?.considered || 0,
        sendable: verificationByLane[lane]?.sendableEmails.length || 0,
      }])),
    };

    snapshot = await freshHealthySnapshot("Fresh Sales safety was temporarily unavailable after email verification");
    const selection = selectVerifiedDailyBatch(snapshot.queue, verifiedEmails, {
      globalLimit: capacity.globalSafeNew,
      productLimits: capacity.productCaps,
      laneLimits: laneTargets,
    });
    const selected = selection.selected;
    if (!selected.length) {
      const state: AutopilotState = { ...EMPTY_STATE, status: "noop", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: clock.date, message: "No MillionVerifier-valid Marita leads fit today's safe capacity." };
      await writeJson(STATE_PATH, state); return { ok: true, state, capacity, verification };
    }

    const prepared = await personalizeBatch(selected);
    snapshot = await freshHealthySnapshot("Fresh Sales safety was temporarily unavailable after personalization");
    const finalSelection = selectVerifiedDailyBatch(snapshot.queue, verifiedEmails, {
      globalLimit: capacity.globalSafeNew,
      productLimits: capacity.productCaps,
      laneLimits: laneTargets,
    });
    const preparedByEmail = new Map(prepared.map((lead) => [lead.email.toLowerCase(), lead]));
    const safe: PreparedLead[] = [];
    for (const current of finalSelection.selected) {
      const personalized = preparedByEmail.get(current.email.toLowerCase());
      if (!personalized || personalized.contactId !== current.contactId || personalized.companyId !== current.companyId || personalized.product !== current.product) continue;
      safe.push({
        ...personalized,
        locale: current.locale,
        greetingName: current.greetingName,
        nameTranslated: current.nameTranslated,
        openingLine: safeOpeningLineForLocale(personalized.openingLine, current.locale),
      });
    }

    const ledger = await readLedger(); const ledgerEmails = new Set(ledger.entries.map((entry) => entry.email.toLowerCase())); const newEntries: LedgerEntry[] = [];
    const laneCounts = Object.fromEntries(LANES.map((lane) => [lane, 0])) as Record<OutreachLane, number>;
    for (const lane of LANES) {
      const definition = VISIBLE_SEQUENCE_LANES[lane];
      const leads = safe.filter((lead) => laneFor(lead.product, lead.locale) === lane && !ledgerEmails.has(lead.email.toLowerCase())).slice(0, laneTargets[lane]);
      for (let index = 0; index < leads.length; index += 400) {
        const chunk = leads.slice(index, index + 400);
        await smartleadRequest(`/campaigns/${campaigns[lane].id}/leads`, { method: "POST", body: JSON.stringify({ lead_list: chunk.map(leadPayload), settings: { ignore_global_block_list: false, ignore_unsubscribe_list: false, ignore_community_bounce_list: false, ignore_duplicate_leads_in_other_campaign: false } }) });
        for (const lead of chunk) { ledgerEmails.add(lead.email.toLowerCase()); newEntries.push({ email: lead.email, contactId: lead.contactId, companyId: lead.companyId, product: definition.product, campaignId: campaigns[lane].id, queuedAt: new Date().toISOString(), lastKnownStatus: "QUEUED" }); laneCounts[lane] += 1; }
        await writeJson(LEDGER_PATH, { version: 1, entries: [...ledger.entries, ...newEntries].slice(-50_000) } satisfies Ledger);
      }
      if (leads.length) await smartleadRequest(`/campaigns/${campaigns[lane].id}/status`, { method: "POST", body: JSON.stringify({ status: "START" }) });
    }

    await writeJson(LEDGER_PATH, { version: 1, entries: [...ledger.entries, ...newEntries].slice(-50_000) } satisfies Ledger);
    const state: AutopilotState = { ...EMPTY_STATE, status: newEntries.length ? "success" : "noop", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: clock.date, prepared: prepared.length, queued: newEntries.length, talentera: newEntries.filter((entry) => entry.product === "talentera").length, evalufy: newEntries.filter((entry) => entry.product === "evalify").length, message: newEntries.length ? "Today's verified batch was routed to visible Smartlead sequences and started." : "No fresh verified lead remained after final safety/dedupe checks." };
    await writeJson(STATE_PATH, state);
    return { ok: true, mode: "autopilot", state, capacity, analytics, verification, laneTargets, laneCounts, salesActivitySync, sequenceTiming: setup.sequenceTiming };
  } catch (error) {
    const pausedCampaigns = await pauseManagedCampaigns().catch(() => 0);
    const state: AutopilotState = { ...EMPTY_STATE, status: "failed", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: previous.lastSuccessfulDate, message: error instanceof Error ? error.message : "Unknown visible-sequence orchestrator error", warnings: [`Managed campaigns paused after failure: ${pausedCampaigns}.`, "No successful daily completion was recorded; the next morning retry may run again."] };
    await writeJson(STATE_PATH, state); throw error;
  }
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(apiKey()),
    primeforgeConfigured: Boolean(clean(process.env.PRIMEFORGE_API_KEY, 8_000)),
    autopilotEnabled: autopilotEnabled(),
    dailyNewLeadTarget: GLOBAL_NEW_LEADS_PER_DAY,
    verification: { provider: "MillionVerifier", fallback: "SignalHire", buffer: VERIFICATION_BUFFER, policy: "Only verified current or verified recovered emails may enter Smartlead." },
    capacityModel: { perMailboxCampaignEmails: MAX_CAMPAIGN_EMAILS_PER_MAILBOX, peakTouchMultiplier: PEAK_TOUCH_MULTIPLIER, safetyFactor: CAPACITY_SAFETY_FACTOR, laneDailyNewCaps: DAILY_LANE_NEW_CAPS },
    campaigns: Object.fromEntries(LANES.map((lane) => [lane, VISIBLE_SEQUENCE_LANES[lane].campaignName])),
    sequences: Object.fromEntries(LANES.map((lane) => [lane, VISIBLE_SEQUENCE_LANES[lane].touches])),
    schedule: { timezone: "Asia/Riyadh", businessDays: "Sunday-Thursday", sendWindow: "09:30-16:30", minimumGapMinutes: MIN_GAP_MINUTES, touch1: "Day 1", touch2: "+4 days", touch3: "+6 days after Touch 2" },
    state: await readState(),
  }, { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized Smartlead orchestrator request." }, { status: 401 });
  const body = object(await request.json().catch(() => ({}))); const mode = clean(body.mode).toLowerCase() || "setup";
  const millionVerifierApiKey = clean(request.headers.get("x-millionverifier-api-key"), 8_000);
  try {
    if (mode === "setup") return NextResponse.json(await setupOnly());
    if (mode === "autopilot") return NextResponse.json(await autopilot(millionVerifierApiKey));
    return NextResponse.json({ error: "mode must be setup or autopilot" }, { status: 400 });
  } catch (error) {
    console.error("Visible-sequence Smartlead orchestrator failed", { mode, error });
    return NextResponse.json({ error: "Smartlead visible-sequence orchestrator failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
