import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { type OutreachProduct } from "@/lib/recipient-language-routing";
import { senderInventory, senderRoute, type SenderProvider } from "@/lib/smartlead-sender-routing";
import { VISIBLE_SEQUENCE_LANES, type OutreachLane } from "@/lib/smartlead-visible-sequences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
const MAX_CAMPAIGN_EMAILS_PER_MAILBOX = 20;
const LANES = Object.keys(VISIBLE_SEQUENCE_LANES) as OutreachLane[];

type JsonObject = Record<string, unknown>;
type Campaign = { id: number; name: string; status: string };
type Sender = {
  id: number;
  email: string;
  domain: string;
  brand: OutreachProduct | "unknown";
  provider: SenderProvider;
  eligible: boolean;
  capacity: number;
};

function clean(value: unknown, max = 4_000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function list(value: unknown, keys: string[] = []) { if (Array.isArray(value)) return value; const item = object(value); for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[]; return [] as unknown[]; }
function numberFrom(value: unknown, keys: string[]) { const item = object(value); for (const key of keys) { const parsed = Number(item[key]); if (Number.isFinite(parsed)) return parsed; } return 0; }
function boolLike(value: unknown) { if (value === true || value === 1 || String(value).toLowerCase() === "true") return true; if (value === false || value === 0 || String(value).toLowerCase() === "false") return false; return null; }
function apiKey() { return clean(process.env.SMARTLEAD_API_KEY, 8_000); }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function authorized(request: NextRequest) { const supplied = clean(request.headers.get("authorization"), 8_000).replace(/^Bearer\s+/i, ""); const expected = apiKey(); return Boolean(expected && supplied && safeEqual(supplied, expected)); }

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
      if ((response.status === 429 || response.status >= 500) && attempt < 3) { await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt)); continue; }
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
  const item = object(value); const id = Number(item.id); const name = clean(item.name);
  if (!Number.isFinite(id) || !name) return null;
  return { id, name, status: clean(item.status) || "UNKNOWN" };
}

async function listCampaigns() {
  const payload = await smartleadRequest<unknown>("/campaigns/", { method: "GET" }, { include_tags: "true" });
  return list(payload, ["campaigns", "data"]).map(parseCampaign).filter((item): item is Campaign => Boolean(item));
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
  const route = senderRoute(item);
  const warmup = object(item.warmup_details || item.warmup); const warmupFlag = boolLike(item.warmup_enabled ?? warmup.enabled ?? warmup.warmup_enabled); const warmupStatus = clean(warmup.status || item.warmup_status).toLowerCase();
  const accountStatus = clean(item.status || item.connection_status || item.smtp_status).toLowerCase();
  const disconnected = /disconnect|failed|error|invalid|suspend/.test(accountStatus);
  const warmEnough = warmupFlag !== false || /complete|ready|active|warm/.test(warmupStatus);
  const rawLimit = numberFrom(item, ["max_email_per_day", "daily_limit", "max_emails_per_day"]);
  const capacity = Math.min(rawLimit > 0 ? rawLimit : MAX_CAMPAIGN_EMAILS_PER_MAILBOX, MAX_CAMPAIGN_EMAILS_PER_MAILBOX);
  return { id, ...route, eligible: route.brand !== "unknown" && !disconnected && warmEnough && capacity > 0, capacity };
}

async function campaignSenderIds(campaign: Campaign) {
  const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/email-accounts`, { method: "GET" });
  return new Set(list(payload, ["email_accounts", "data", "accounts"]).map((value) => Number(object(value).id ?? object(value).email_account_id)).filter(Number.isFinite));
}

function inactiveLead(row: JsonObject) {
  return /complete|stopp|unsub|bounce|repl/i.test(clean(row.status || row.lead_status || row.email_status || row.category));
}

async function activeCampaignLeads(campaign: Campaign) {
  for (let offset = 0; offset < 5_000; offset += 100) {
    const payload = await smartleadRequest<unknown>(`/campaigns/${campaign.id}/leads`, { method: "GET" }, { offset: String(offset), limit: "100" });
    const batch = list(payload, ["leads", "data", "results"]).map(object);
    if (batch.some((row) => !inactiveLead(row))) return true;
    if (batch.length < 100) return false;
  }
  return true;
}

async function configureEspMatching(lane: OutreachLane, campaign: Campaign) {
  const language = VISIBLE_SEQUENCE_LANES[lane].language;
  await smartleadRequest(`/campaigns/${campaign.id}/settings`, {
    method: "POST",
    body: JSON.stringify({
      track_settings: ["DONT_EMAIL_OPEN", "DONT_LINK_CLICK"],
      stop_lead_settings: "REPLY_TO_AN_EMAIL",
      unsubscribe_text: language === "ar" ? "غير مناسب؟ رد لا" : "Not relevant? Reply no",
      send_as_plain_text: true,
      follow_up_percentage: 100,
      enable_ai_esp_matching: true,
      client_id: null,
    }),
  });
}

function providerCounts(senders: Sender[], product: OutreachProduct) {
  return {
    google: senders.filter((sender) => sender.eligible && sender.brand === product && sender.provider === "google").length,
    microsoft: senders.filter((sender) => sender.eligible && sender.brand === product && sender.provider === "microsoft").length,
    smtp: senders.filter((sender) => sender.eligible && sender.brand === product && sender.provider === "smtp").length,
    unknown: senders.filter((sender) => sender.eligible && sender.brand === product && sender.provider === "unknown").length,
  };
}

async function reconcile() {
  const [campaignRows, rawAccounts] = await Promise.all([listCampaigns(), listEmailAccounts()]);
  const senders = rawAccounts.map(parseSender).filter((item): item is Sender => Boolean(item));
  const campaignByName = new Map(campaignRows.map((campaign) => [campaign.name, campaign]));
  const laneResult = {} as Record<OutreachLane, { campaignId: number; desired: number; added: number; removed: number; current: number; product: OutreachProduct }>;
  const warnings: string[] = [];

  for (const lane of LANES) {
    const definition = VISIBLE_SEQUENCE_LANES[lane];
    const campaign = campaignByName.get(definition.campaignName);
    if (!campaign) throw new Error(`${definition.campaignName} does not exist yet.`);

    const desiredIds = new Set(senders.filter((sender) => sender.eligible && sender.brand === definition.product).map((sender) => sender.id));
    const currentIds = await campaignSenderIds(campaign);
    const wrongIds = [...currentIds].filter((id) => !desiredIds.has(id));
    const missingIds = [...desiredIds].filter((id) => !currentIds.has(id));
    let removed = 0;

    if (wrongIds.length) {
      if (await activeCampaignLeads(campaign)) {
        warnings.push(`${definition.label}: ${wrongIds.length} incompatible sender(s) are attached while active leads exist; no sender was removed mid-sequence.`);
      } else {
        await smartleadRequest(`/campaigns/${campaign.id}/email-accounts`, { method: "DELETE", body: JSON.stringify({ email_account_ids: wrongIds }) });
        removed = wrongIds.length;
      }
    }

    if (missingIds.length) {
      await smartleadRequest(`/campaigns/${campaign.id}/email-accounts`, { method: "POST", body: JSON.stringify({ email_account_ids: missingIds }) });
    }

    await configureEspMatching(lane, campaign);
    const finalIds = await campaignSenderIds(campaign);
    const incompatibleFinal = [...finalIds].filter((id) => !desiredIds.has(id));
    if (incompatibleFinal.length) warnings.push(`${definition.label}: ${incompatibleFinal.length} incompatible sender(s) remain attached.`);

    laneResult[lane] = {
      campaignId: campaign.id,
      desired: desiredIds.size,
      added: missingIds.length,
      removed,
      current: finalIds.size,
      product: definition.product,
    };
  }

  return {
    ok: true,
    mode: "sender-reconcile",
    blocked: warnings.some((warning) => /incompatible sender\(s\) remain|active leads exist/.test(warning)),
    policy: "Brand gate first; Smartlead ESP matching chooses Google/Outlook only inside the matching brand pool.",
    providerMatching: true,
    lanes: laneResult,
    providers: {
      talentera: providerCounts(senders, "talentera"),
      evalufy: providerCounts(senders, "evalify"),
    },
    inventory: senderInventory(rawAccounts.map((row) => object(row))),
    unclassified: senders.filter((sender) => sender.brand === "unknown").map((sender) => ({ domain: sender.domain, provider: sender.provider, eligible: sender.eligible })),
    warnings,
  };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized sender reconciliation request." }, { status: 401 });
  try {
    return NextResponse.json(await reconcile(), { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("Smartlead sender reconciliation failed", { error });
    return NextResponse.json({ error: "Smartlead sender reconciliation failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
