import { timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { openRouterCompletion } from "@/lib/openrouter-low-cost";
import { isGccCountry, isKsaCountry, senderBrand, type OutreachProduct, type RecipientLocale } from "@/lib/recipient-language-routing";
import { getSmartleadV2, sequenceTemplate, type V2Lead } from "@/lib/smartlead-v2";
import { renderOutreachTemplate, sanitizeOutreachText } from "@/lib/smartlead-policy";

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
const STATE_PATH = process.env.SMARTLEAD_AUTOPILOT_STATE_PATH || "/app/data/smartlead-v2-autopilot.json";
const LEDGER_PATH = process.env.SMARTLEAD_V2_LEDGER_PATH || "/app/data/smartlead-v2-ledger.json";
const BUSINESS_DAYS = new Set(["Sun", "Mon", "Tue", "Wed", "Thu"]);
const BOUNCE_GUARD_MIN_SENT = 50;
const BOUNCE_GUARD_RATE = 0.03;

const CAMPAIGNS: Record<OutreachProduct, { name: string; label: string }> = {
  talentera: { name: "Talentera | Marita SDR | KSA-GCC | V1", label: "Talentera" },
  evalify: { name: "Evalufy | Marita SDR | Existing ATS | V1", label: "Evalufy" },
};

type JsonObject = Record<string, unknown>;
type Campaign = { id: number; name: string; status: string };
type Sender = { id: number; email: string; brand: OutreachProduct | "unknown"; capacity: number; eligible: boolean };
type LedgerEntry = { email: string; contactId: string; companyId: string; product: OutreachProduct; campaignId: number; queuedAt: string; lastKnownStatus: string };
type Ledger = { version: 1; entries: LedgerEntry[] };
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

type PreparedLead = V2Lead & {
  openingLine: string;
  subject1: string;
  touch1: string;
  subject2: string;
  touch2: string;
  subject3: string;
  touch3: string;
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
  message: "Final Smartlead orchestrator has not run yet.",
  warnings: [],
};

function clean(value: unknown, max = 4_000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function list(value: unknown, keys: string[] = []) { if (Array.isArray(value)) return value; const item = object(value); for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[]; return [] as unknown[]; }
function numberFrom(value: unknown, keys: string[]) { const item = object(value); for (const key of keys) { const parsed = Number(item[key]); if (Number.isFinite(parsed)) return parsed; } return 0; }
function boolLike(value: unknown) { if (value === true || value === 1 || String(value).toLowerCase() === "true") return true; if (value === false || value === 0 || String(value).toLowerCase() === "false") return false; return null; }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function apiKey() { return clean(process.env.SMARTLEAD_API_KEY, 8_000); }
function authorized(request: NextRequest) { const supplied = clean(request.headers.get("authorization"), 8_000).replace(/^Bearer\s+/i, ""); const expected = apiKey(); return Boolean(expected && supplied && safeEqual(supplied, expected)); }

function riyadhClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, weekday: value("weekday"), hour: Number(value("hour") || 0), minute: Number(value("minute") || 0) };
}

async function readJson<T>(file: string, fallback: T): Promise<T> { try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return fallback; } }
async function writeJson(file: string, value: unknown) { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp-${process.pid}`; await fs.writeFile(tmp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 }); await fs.rename(tmp, file); }
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

function sequencePayload() {
  return [
    { seq_number: 1, seq_delay_details: { delay_in_days: 0 }, variant_distribution_type: "MANUALLY_EQUAL", variants: [{ subject: "{{sl_subject_1}}", email_body: "{{sl_touch_1}}", variant_label: "A" }] },
    { seq_number: 2, seq_delay_details: { delay_in_days: 3 }, variant_distribution_type: "MANUALLY_EQUAL", variants: [{ subject: "{{sl_subject_2}}", email_body: "{{sl_touch_2}}", variant_label: "A" }] },
    { seq_number: 3, seq_delay_details: { delay_in_days: 4 }, variant_distribution_type: "MANUALLY_EQUAL", variants: [{ subject: "{{sl_subject_3}}", email_body: "{{sl_touch_3}}", variant_label: "A" }] },
  ];
}

async function configureCampaign(campaign: Campaign) {
  await smartleadRequest(`/campaigns/${campaign.id}/settings`, { method: "POST", body: JSON.stringify({ track_settings: ["DONT_EMAIL_OPEN", "DONT_LINK_CLICK"], stop_lead_settings: "REPLY_TO_AN_EMAIL", unsubscribe_text: "Not relevant? Reply no / غير مناسب؟ رد لا", send_as_plain_text: true, follow_up_percentage: 100, enable_ai_esp_matching: false, client_id: null }) });
  await smartleadRequest(`/campaigns/${campaign.id}/schedule`, { method: "POST", body: JSON.stringify({ timezone: "Asia/Riyadh", days_of_the_week: [0, 1, 2, 3, 4], start_hour: "09:30", end_hour: "16:30", min_time_btw_emails: MIN_GAP_MINUTES, max_leads_per_day: GLOBAL_NEW_LEADS_PER_DAY }) });
  await smartleadRequest(`/campaigns/${campaign.id}/sequences`, { method: "POST", body: JSON.stringify(sequencePayload()) });
}

async function ensureCampaign(product: OutreachProduct) {
  let campaigns = await listCampaigns(); let campaign = campaigns.find((item) => item.name === CAMPAIGNS[product].name) ?? null;
  if (!campaign) {
    const created = await smartleadRequest<unknown>("/campaigns/create", { method: "POST", body: JSON.stringify({ name: CAMPAIGNS[product].name, client_id: null }) });
    campaign = parseCampaign(created);
    if (!campaign) { campaigns = await listCampaigns(); campaign = campaigns.find((item) => item.name === CAMPAIGNS[product].name) ?? null; }
  }
  if (!campaign) throw new Error(`${CAMPAIGNS[product].label} campaign could not be created.`);
  await configureCampaign(campaign);
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
  const email = clean(item.from_email || item.email || item.username).toLowerCase(); const brand = senderBrand(email);
  const warmup = object(item.warmup_details || item.warmup); const warmupFlag = boolLike(item.warmup_enabled ?? warmup.enabled ?? warmup.warmup_enabled); const warmupStatus = clean(warmup.status || item.warmup_status).toLowerCase();
  const accountStatus = clean(item.status || item.connection_status || item.smtp_status).toLowerCase();
  const disconnected = /disconnect|failed|error|invalid|suspend/.test(accountStatus);
  const warmEnough = warmupFlag !== false || /complete|ready|active|warm/.test(warmupStatus);
  const rawLimit = numberFrom(item, ["max_email_per_day", "daily_limit", "max_emails_per_day"]); const capacity = Math.min(rawLimit > 0 ? rawLimit : MAX_CAMPAIGN_EMAILS_PER_MAILBOX, MAX_CAMPAIGN_EMAILS_PER_MAILBOX);
  return { id, email, brand, capacity, eligible: brand !== "unknown" && !disconnected && warmEnough && capacity > 0 };
}

async function syncSenders(campaigns: Record<OutreachProduct, Campaign>) {
  const senders = (await listEmailAccounts()).map(parseSender).filter((item): item is Sender => Boolean(item));
  const attached: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) {
    const ids = senders.filter((sender) => sender.eligible && sender.brand === product).map((sender) => sender.id);
    if (ids.length) await smartleadRequest(`/campaigns/${campaigns[product].id}/email-accounts`, { method: "POST", body: JSON.stringify({ email_account_ids: ids }) });
    attached[product] = ids.length;
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
  const rawTotal = productCaps.talentera + productCaps.evalify;
  const globalSafeNew = Math.min(GLOBAL_NEW_LEADS_PER_DAY, rawTotal);
  return { productCaps, productEmailCapacity, globalSafeNew, peakTouchMultiplier: PEAK_TOUCH_MULTIPLIER, safetyFactor: CAPACITY_SAFETY_FACTOR };
}

async function campaignAnalytics(campaign: Campaign) {
  const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/analytics`, { method: "GET" }).catch(() => ({}));
  const sent = numberFrom(payload, ["sent_count", "sent", "total_sent", "emails_sent"]); const bounces = numberFrom(payload, ["bounce_count", "bounces", "total_bounces"]);
  return { sent, bounces, bounceRate: sent ? bounces / sent : 0, replies: numberFrom(payload, ["reply_count", "replies", "total_replies"]) };
}

function painFor(lead: V2Lead, locale: RecipientLocale) {
  const ar = locale !== "en"; const product = lead.product; const bucket = lead.industryBucket;
  if (product === "evalify") {
    const en: Record<string, string> = { healthcare: "screening clinical and non-clinical candidates consistently before interviews", retail: "screening high applicant volumes before recruiter interviews", logistics: "assessing operational candidates quickly and consistently", "financial-services": "standardising assessments and shortlisting", education: "screening applicants consistently across departments", hospitality: "assessing high-volume operational applicants before interviews", technology: "validating specialist skills before interview time is used", other: "screening and assessing candidates before interviews", unknown: "screening and assessing candidates before interviews" };
    const arMap: Record<string, string> = { healthcare: "فرز وتقييم المرشحين للوظائف الطبية والإدارية قبل المقابلات", retail: "فرز أعداد كبيرة من المتقدمين قبل وقت فريق التوظيف", logistics: "تقييم المرشحين للوظائف التشغيلية بشكل أسرع وأكثر اتساقا", "financial-services": "توحيد التقييم والـshortlisting قبل المقابلات", education: "تقييم المتقدمين بشكل موحد بين الأقسام", hospitality: "فرز وتقييم المرشحين للوظائف التشغيلية قبل المقابلات", technology: "التحقق من مهارات المرشحين قبل استهلاك وقت الفريق", other: "فرز وتقييم المرشحين قبل المقابلات", unknown: "فرز وتقييم المرشحين قبل المقابلات" };
    return (ar ? arMap : en)[bucket] || (ar ? arMap.other : en.other);
  }
  const en: Record<string, string> = { healthcare: "clinical and non-clinical hiring across multiple teams", retail: "high-volume frontline hiring across locations", logistics: "operational and warehouse hiring at speed", "financial-services": "structured hiring with multiple approvals", education: "seasonal hiring across departments", hospitality: "high-volume operational hiring across locations", technology: "specialist hiring without extra recruiter admin", other: "screening, interviews, approvals and offers across one recruitment flow", unknown: "screening, interviews, approvals and offers across one recruitment flow" };
  const arMap: Record<string, string> = { healthcare: "التوظيف للوظائف الطبية والإدارية مع تعدد الفرق والموافقات", retail: "التوظيف التشغيلي للفروع والتعامل مع أعداد كبيرة من المرشحين", logistics: "التوظيف التشغيلي والمستودعات بسرعة", "financial-services": "تنظيم مراحل التوظيف والموافقات الداخلية", education: "التوظيف الموسمي وتعدد الأقسام", hospitality: "التوظيف التشغيلي لعدة مواقع", technology: "توظيف الكفاءات المتخصصة وتقليل العمل اليدوي", other: "ربط الفرز والمقابلات والموافقات والعروض", unknown: "ربط الفرز والمقابلات والموافقات والعروض" };
  return (ar ? arMap : en)[bucket] || (ar ? arMap.other : en.other);
}

function parseAiJson(content: string) { try { const start = content.indexOf("{"); const end = content.lastIndexOf("}"); if (start < 0 || end <= start) return {}; return object(JSON.parse(content.slice(start, end + 1))); } catch { return {}; } }

async function personalizeLead(lead: V2Lead): Promise<PreparedLead> {
  let locale = lead.locale; let greetingName = lead.greetingName || lead.firstName; let openingLine = "";
  try {
    const result = await openRouterCompletion({
      cacheKey: `smartlead-final:${lead.email}:${lead.product}:${lead.industryBucket}:${lead.persona}:${lead.detectedAts}`,
      mode: "fast", maxOutputTokens: 180, temperature: 0.1,
      system: [
        "You are a conservative GCC B2B cold-email recipient-intelligence checker.",
        "Return ONLY JSON with locale,greetingName,nameConfidence,openingLine.",
        "locale must be ar-SA, ar-GCC, or en.",
        "Never infer nationality. Arabic is allowed only when the first name is clearly Arabic and the person is in GCC. Ambiguous names stay English.",
        "openingLine must be short, non-creepy, and based only on industry/persona/product context. Never claim you saw, researched, noticed, verified or know company activity.",
        "No links, emojis, hype, fake metrics or unsupported claims.",
      ].join(" "),
      user: JSON.stringify({ firstName: lead.firstName, fullName: lead.fullName, country: lead.country, industry: lead.industryBucket, persona: lead.persona, product: lead.product === "evalify" ? "Evalufy" : "Talentera", ats: lead.detectedAts || "none visible" }),
    });
    const data = parseAiJson(result.content); const requestedLocale = clean(data.locale) as RecipientLocale; const confidence = Number(data.nameConfidence); const candidateName = clean(data.greetingName, 60);
    const safeArabic = isGccCountry(lead.country) && (requestedLocale === "ar-SA" || requestedLocale === "ar-GCC") && Number.isFinite(confidence) && confidence >= AI_ARABIC_CONFIDENCE && /[\u0600-\u06FF]/.test(candidateName);
    if (safeArabic) { locale = isKsaCountry(lead.country) ? "ar-SA" : "ar-GCC"; greetingName = candidateName; }
    openingLine = sanitizeOutreachText(clean(data.openingLine, 220), 220);
  } catch {
    openingLine = "";
  }
  const templateLocale: RecipientLocale = locale === "en" ? "en" : "ar-SA";
  const template = sequenceTemplate(lead.product, templateLocale);
  const values = { first_name: greetingName, company_name: lead.companyName, opening_line: openingLine, industry_pain: painFor(lead, locale) };
  const normalizeBrand = (value: string) => value.replace(/Evalify/g, "Evalufy");
  return {
    ...lead, locale, greetingName, openingLine,
    subject1: normalizeBrand(sanitizeOutreachText(renderOutreachTemplate(template.subject1, values), 90)),
    touch1: normalizeBrand(sanitizeOutreachText(renderOutreachTemplate(template.touch1, values), 650)),
    subject2: normalizeBrand(sanitizeOutreachText(renderOutreachTemplate(template.subject2, values), 90)),
    touch2: normalizeBrand(sanitizeOutreachText(renderOutreachTemplate(template.touch2, values), 520)),
    subject3: normalizeBrand(sanitizeOutreachText(renderOutreachTemplate(template.subject3, values), 90)),
    touch3: normalizeBrand(sanitizeOutreachText(renderOutreachTemplate(template.touch3, values), 340)),
  };
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
      sl_subject_1: lead.subject1, sl_touch_1: lead.touch1,
      sl_subject_2: lead.subject2, sl_touch_2: lead.touch2,
      sl_subject_3: lead.subject3, sl_touch_3: lead.touch3,
      sdr_owner: "Marita", hubspot_contact_id: lead.contactId, hubspot_company_id: lead.companyId,
      locale: lead.locale, greeting_name: lead.greetingName, product: lead.product === "evalify" ? "Evalufy" : "Talentera",
      industry: lead.industryBucket, persona: lead.persona, ats: lead.detectedAts,
    },
  };
}

async function setupOnly() {
  const [talentera, evalify] = await Promise.all([ensureCampaign("talentera"), ensureCampaign("evalify")]);
  const campaigns = { talentera, evalify };
  const senderSync = await syncSenders(campaigns); const capacity = capacityPlan(senderSync.senders);
  return {
    ok: true, mode: "setup", activated: false, queued: 0,
    campaigns: { talentera: { id: talentera.id, name: talentera.name }, evalufy: { id: evalify.id, name: evalify.name } },
    sequence: { touch1: "Day 0", touch2: "+3 days", touch3: "+4 days after Touch 2 (~Day 7)", stopOnReply: true, plainText: true, tracking: "off" },
    sendWindow: { timezone: "Asia/Riyadh", days: "Sunday-Thursday", hours: "09:30-16:30", minimumGapMinutes: MIN_GAP_MINUTES },
    senders: senderSync.attached,
    capacity,
  };
}

async function autopilot() {
  const clock = riyadhClock(); const previous = await readState();
  if (!BUSINESS_DAYS.has(clock.weekday)) return { ok: true, skipped: true, reason: "KSA weekend; no new cold outreach is queued.", state: previous };
  if (previous.lastSuccessfulDate === clock.date && ["success", "noop"].includes(previous.status)) return { ok: true, skipped: true, reason: "Today's batch was already processed successfully.", state: previous };

  const startedAt = new Date().toISOString();
  await writeJson(STATE_PATH, { ...EMPTY_STATE, status: "running", riyadhDate: clock.date, startedAt, lastSuccessfulDate: previous.lastSuccessfulDate, message: "Running final Smartlead autopilot with peak-aware capacity." } satisfies AutopilotState);

  try {
    const setup = await setupOnly();
    const campaigns: Record<OutreachProduct, Campaign> = {
      talentera: { id: setup.campaigns.talentera.id, name: setup.campaigns.talentera.name, status: "" },
      evalify: { id: setup.campaigns.evalufy.id, name: setup.campaigns.evalufy.name, status: "" },
    };
    const senderRows = (await listEmailAccounts()).map(parseSender).filter((item): item is Sender => Boolean(item)); const capacity = capacityPlan(senderRows);
    if (capacity.globalSafeNew < 1) throw new Error("No safe brand-matched sender capacity is available.");

    const analytics = { talentera: await campaignAnalytics(campaigns.talentera), evalify: await campaignAnalytics(campaigns.evalify) };
    const reputationWarnings: string[] = [];
    for (const product of ["talentera", "evalify"] as OutreachProduct[]) if (analytics[product].sent >= BOUNCE_GUARD_MIN_SENT && analytics[product].bounceRate >= BOUNCE_GUARD_RATE) reputationWarnings.push(`${CAMPAIGNS[product].label} bounce rate is ${(analytics[product].bounceRate * 100).toFixed(1)}% after ${analytics[product].sent} sends.`);
    if (reputationWarnings.length) {
      const state: AutopilotState = { ...EMPTY_STATE, status: "blocked", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: previous.lastSuccessfulDate, message: "Reputation guard blocked new outreach.", warnings: reputationWarnings };
      await writeJson(STATE_PATH, state); return { ok: true, blocked: true, reason: state.message, warnings: state.warnings, state };
    }

    let snapshot = await getSmartleadV2(true);
    if (!snapshot.safety.healthy) {
      const state: AutopilotState = { ...EMPTY_STATE, status: "blocked", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: previous.lastSuccessfulDate, message: "HubSpot Sales safety is not healthy; no lead was queued.", warnings: snapshot.safety.warnings };
      await writeJson(STATE_PATH, state); return { ok: true, blocked: true, reason: state.message, warnings: state.warnings, state };
    }
    if (!snapshot.configuration.openRouterConfigured) throw new Error("OpenRouter is not configured in production.");

    const productCount: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 }; const selected: V2Lead[] = [];
    for (const lead of snapshot.queue) {
      if (!lead.eligible) continue;
      if (productCount[lead.product] >= capacity.productCaps[lead.product]) continue;
      selected.push(lead); productCount[lead.product] += 1;
      if (selected.length >= capacity.globalSafeNew) break;
    }
    if (!selected.length) {
      const state: AutopilotState = { ...EMPTY_STATE, status: "noop", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: clock.date, message: "No eligible Marita leads fit today's safe product capacity." };
      await writeJson(STATE_PATH, state); return { ok: true, state, capacity };
    }

    const prepared = await personalizeBatch(selected);
    snapshot = await getSmartleadV2(true);
    if (!snapshot.safety.healthy) throw new Error("Fresh Sales safety changed during personalization; queue aborted.");
    const fresh = new Map(snapshot.queue.filter((lead) => lead.eligible).map((lead) => [lead.email.toLowerCase(), lead]));
    const safe = prepared.filter((lead) => { const current = fresh.get(lead.email.toLowerCase()); return current && current.contactId === lead.contactId && current.companyId === lead.companyId && current.product === lead.product; });

    const ledger = await readLedger(); const ledgerEmails = new Set(ledger.entries.map((entry) => entry.email.toLowerCase())); const newEntries: LedgerEntry[] = [];
    for (const product of ["talentera", "evalify"] as OutreachProduct[]) {
      const leads = safe.filter((lead) => lead.product === product && !ledgerEmails.has(lead.email.toLowerCase()));
      for (let index = 0; index < leads.length; index += 400) {
        const chunk = leads.slice(index, index + 400);
        await smartleadRequest(`/campaigns/${campaigns[product].id}/leads`, { method: "POST", body: JSON.stringify({ lead_list: chunk.map(leadPayload), settings: { ignore_global_block_list: false, ignore_unsubscribe_list: false, ignore_community_bounce_list: false, ignore_duplicate_leads_in_other_campaign: false } }) });
        for (const lead of chunk) { ledgerEmails.add(lead.email.toLowerCase()); newEntries.push({ email: lead.email, contactId: lead.contactId, companyId: lead.companyId, product, campaignId: campaigns[product].id, queuedAt: new Date().toISOString(), lastKnownStatus: "QUEUED" }); }
      }
      if (leads.length) await smartleadRequest(`/campaigns/${campaigns[product].id}/status`, { method: "PATCH", body: JSON.stringify({ status: "START" }) });
    }

    await writeJson(LEDGER_PATH, { version: 1, entries: [...ledger.entries, ...newEntries].slice(-50_000) } satisfies Ledger);
    const state: AutopilotState = { ...EMPTY_STATE, status: newEntries.length ? "success" : "noop", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: clock.date, prepared: prepared.length, queued: newEntries.length, talentera: newEntries.filter((entry) => entry.product === "talentera").length, evalufy: newEntries.filter((entry) => entry.product === "evalify").length, message: newEntries.length ? "Today's safe batch was queued to Smartlead and campaigns were started." : "No fresh lead remained after final safety/dedupe checks." };
    await writeJson(STATE_PATH, state);
    return { ok: true, mode: "autopilot", state, capacity, analytics, sequence: { touch1: "Day 0", touch2: "+3 days", touch3: "+4 days after Touch 2" } };
  } catch (error) {
    const state: AutopilotState = { ...EMPTY_STATE, status: "failed", riyadhDate: clock.date, startedAt, finishedAt: new Date().toISOString(), lastSuccessfulDate: previous.lastSuccessfulDate, message: error instanceof Error ? error.message : "Unknown final Smartlead orchestrator error", warnings: ["No successful daily completion was recorded; the next morning retry may run again."] };
    await writeJson(STATE_PATH, state); throw error;
  }
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(apiKey()),
    dailyNewLeadTarget: GLOBAL_NEW_LEADS_PER_DAY,
    capacityModel: { perMailboxCampaignEmails: MAX_CAMPAIGN_EMAILS_PER_MAILBOX, peakTouchMultiplier: PEAK_TOUCH_MULTIPLIER, safetyFactor: CAPACITY_SAFETY_FACTOR },
    campaigns: { talentera: CAMPAIGNS.talentera.name, evalufy: CAMPAIGNS.evalify.name },
    sequence: { touch1: "Day 0", touch2: "+3 days", touch3: "+4 days after Touch 2 (~Day 7)", stopOnReply: true },
    schedule: { timezone: "Asia/Riyadh", businessDays: "Sunday-Thursday", sendWindow: "09:30-16:30", minimumGapMinutes: MIN_GAP_MINUTES },
    state: await readState(),
  }, { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized Smartlead orchestrator request." }, { status: 401 });
  const body = object(await request.json().catch(() => ({}))); const mode = clean(body.mode).toLowerCase() || "setup";
  try {
    if (mode === "setup") return NextResponse.json(await setupOnly());
    if (mode === "autopilot") return NextResponse.json(await autopilot());
    return NextResponse.json({ error: "mode must be setup or autopilot" }, { status: 400 });
  } catch (error) {
    console.error("Final Smartlead orchestrator failed", { mode, error });
    return NextResponse.json({ error: "Smartlead orchestrator failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
