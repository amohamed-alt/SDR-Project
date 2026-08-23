import { NextRequest, NextResponse } from "next/server";
import { decideRecipientLanguage, type OutreachProduct } from "@/lib/recipient-language-routing";
import { smartleadActionAuthConfigured, smartleadActionAuthorized, smartleadSameOrigin } from "@/lib/smartlead-action-auth";
import { getSmartleadV2, type SmartleadV2Payload, type V2Campaign } from "@/lib/smartlead-v2";
import { VISIBLE_SEQUENCE_LANES, type OutreachLane } from "@/lib/smartlead-visible-sequences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
const MAX_EMAILS_PER_MAILBOX = 20;
const PEAK_TOUCH_MULTIPLIER = 5;
const CAPACITY_SAFETY_FACTOR = 0.85;
const LANES = Object.keys(VISIBLE_SEQUENCE_LANES) as OutreachLane[];

type JsonObject = Record<string, unknown>;
type CanonicalCampaign = { id: number; name: string; status: string; lane: OutreachLane };

function clean(value: unknown, max = 2_000) { return String(value ?? "").trim().slice(0, max); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function list(value: unknown, keys: string[] = []) { if (Array.isArray(value)) return value; const item = object(value); for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[]; return [] as unknown[]; }
function numberFrom(value: unknown, keys: string[]) { const item = object(value); for (const key of keys) { const parsed = Number(item[key]); if (Number.isFinite(parsed)) return parsed; } return 0; }
function dailyTarget() { const parsed = Number(process.env.SMARTLEAD_DAILY_NEW_LEADS || 50); return Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.floor(parsed))) : 50; }

async function smartleadGet(endpoint: string, query: Record<string, string> = {}) {
  const apiKey = clean(process.env.SMARTLEAD_API_KEY, 8_000);
  if (!apiKey) throw new Error("SMARTLEAD_API_KEY is not configured.");
  const params = new URLSearchParams({ api_key: apiKey, ...query });
  const response = await fetch(`${SMARTLEAD_API}${endpoint}?${params}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`Smartlead ${endpoint} returned ${response.status}.`);
  return await response.json() as unknown;
}

async function canonicalCampaigns() {
  const payload = await smartleadGet("/campaigns/", { include_tags: "true" });
  const rows = list(payload, ["campaigns", "data"]);
  const campaigns = {} as Partial<Record<OutreachLane, CanonicalCampaign>>;
  for (const lane of LANES) {
    const expected = VISIBLE_SEQUENCE_LANES[lane].campaignName;
    const row = rows.map(object).find((item) => clean(item.name) === expected);
    const id = Number(row?.id);
    if (row && Number.isFinite(id)) campaigns[lane] = { id, name: expected, status: clean(row.status) || "UNKNOWN", lane };
  }
  return campaigns;
}

async function campaignSenderIds(campaign: CanonicalCampaign | undefined) {
  if (!campaign) return new Set<number>();
  const payload = await smartleadGet(`/campaigns/${campaign.id}/email-accounts`);
  return new Set(list(payload, ["email_accounts", "data", "accounts"])
    .map((row) => Number(object(row).id ?? object(row).email_account_id))
    .filter(Number.isFinite));
}

async function campaignAnalytics(campaign: CanonicalCampaign | undefined) {
  if (!campaign) return { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0 };
  const payload = await smartleadGet(`/campaigns/${campaign.id}/analytics`).catch(() => ({}));
  return {
    sent: numberFrom(payload, ["sent_count", "sent", "total_sent", "emails_sent"]),
    replies: numberFrom(payload, ["reply_count", "replies", "total_replies"]),
    bounces: numberFrom(payload, ["bounce_count", "bounces", "total_bounces"]),
    unsubscribed: numberFrom(payload, ["unsubscribe_count", "unsubscribed", "total_unsubscribed"]),
    activeLeads: numberFrom(payload, ["active_leads", "active_leads_count", "active"]),
  };
}

function canonicalTemplate(lane: OutreachLane) {
  const touches = VISIBLE_SEQUENCE_LANES[lane].touches;
  const first = touches[0]; const second = touches[1]; const third = touches[2];
  return {
    subject1: first?.subject || "", touch1: first?.body || "",
    subject2: second?.subject || "", touch2: second?.body || "",
    subject3: third?.subject || "", touch3: third?.body || "",
  };
}

function representativeCampaign(product: OutreachProduct, campaigns: Partial<Record<OutreachLane, CanonicalCampaign>>): V2Campaign | null {
  const lane: OutreachLane = product === "talentera" ? "talentera_en" : "evalufy_en";
  const campaign = campaigns[lane] || campaigns[product === "talentera" ? "talentera_ar" : "evalufy_ar"];
  if (!campaign) return null;
  return { id: campaign.id, name: campaign.name, status: campaign.status, maxLeadsPerDay: dailyTarget(), timezone: "Asia/Riyadh", product };
}

async function canonicalOverlay(payload: SmartleadV2Payload): Promise<SmartleadV2Payload> {
  const campaigns = await canonicalCampaigns();
  const senderSets = Object.fromEntries(await Promise.all(LANES.map(async (lane) => [lane, await campaignSenderIds(campaigns[lane])] as const))) as Record<OutreachLane, Set<number>>;
  const laneAnalytics = Object.fromEntries(await Promise.all(LANES.map(async (lane) => [lane, await campaignAnalytics(campaigns[lane])] as const))) as Record<OutreachLane, Awaited<ReturnType<typeof campaignAnalytics>>>;

  const productSenderIds: Record<OutreachProduct, Set<number>> = { talentera: new Set<number>(), evalify: new Set<number>() };
  for (const lane of LANES) for (const id of senderSets[lane]) productSenderIds[VISIBLE_SEQUENCE_LANES[lane].product].add(id);

  const senders = payload.senders.map((sender) => ({
    ...sender,
    assignedProducts: (["talentera", "evalify"] as OutreachProduct[]).filter((product) => productSenderIds[product].has(sender.id) && sender.brand === product),
  }));
  const eligible = senders.filter((sender) => sender.eligible);
  const assigned = eligible.filter((sender) => sender.brand !== "unknown" && productSenderIds[sender.brand].has(sender.id));
  const senderCapacity = (maxPerDay: number) => Math.min(MAX_EMAILS_PER_MAILBOX, maxPerDay > 0 ? maxPerDay : MAX_EMAILS_PER_MAILBOX);
  const potentialCampaignEmailsPerDay = eligible.reduce((sum, sender) => sum + senderCapacity(sender.maxPerDay), 0);
  const liveCampaignEmailsPerDay = assigned.reduce((sum, sender) => sum + senderCapacity(sender.maxPerDay), 0);
  const productLiveNewCaps: Record<OutreachProduct, number> = { talentera: 0, evalify: 0 };
  for (const product of ["talentera", "evalify"] as OutreachProduct[]) {
    const emailCapacity = assigned.filter((sender) => sender.brand === product).reduce((sum, sender) => sum + senderCapacity(sender.maxPerDay), 0);
    productLiveNewCaps[product] = Math.floor((emailCapacity / PEAK_TOUCH_MULTIPLIER) * CAPACITY_SAFETY_FACTOR);
  }
  const liveNewLeadsPerDay = Math.min(dailyTarget(), productLiveNewCaps.talentera + productLiveNewCaps.evalify);
  const potentialNewLeadsPerDay = Math.min(dailyTarget(), Math.floor((potentialCampaignEmailsPerDay / PEAK_TOUCH_MULTIPLIER) * CAPACITY_SAFETY_FACTOR));

  const queue = payload.queue.map((lead) => {
    const decision = decideRecipientLanguage({ firstName: lead.firstName, fullName: lead.fullName, country: lead.country });
    return { ...lead, locale: decision.locale, greetingName: decision.greetingName, languageConfidence: decision.confidence, languageReason: decision.reason, nameTranslated: decision.translated };
  });
  const ready = queue.filter((lead) => lead.eligible);

  const aggregate = (product: OutreachProduct) => {
    const lanes = LANES.filter((lane) => VISIBLE_SEQUENCE_LANES[lane].product === product);
    const values = lanes.map((lane) => laneAnalytics[lane]);
    const sent = values.reduce((sum, row) => sum + row.sent, 0); const bounces = values.reduce((sum, row) => sum + row.bounces, 0);
    return {
      sent,
      replies: values.reduce((sum, row) => sum + row.replies, 0),
      bounces,
      unsubscribed: values.reduce((sum, row) => sum + row.unsubscribed, 0),
      activeLeads: values.reduce((sum, row) => sum + row.activeLeads, 0),
      bounceRate: sent ? bounces / sent : 0,
    };
  };

  const today = Math.min(ready.length, liveNewLeadsPerDay);
  return {
    ...payload,
    configuration: { ...payload.configuration, ownerActionsConfigured: smartleadActionAuthConfigured(), globalDailyNewTarget: dailyTarget(), minTimeBetweenEmails: Math.max(15, payload.configuration.minTimeBetweenEmails || 15) },
    campaigns: { talentera: representativeCampaign("talentera", campaigns), evalify: representativeCampaign("evalify", campaigns) },
    analytics: { talentera: aggregate("talentera"), evalify: aggregate("evalify") },
    senders,
    capacity: {
      totalInboxes: senders.length,
      eligibleInboxes: eligible.length,
      assignedInboxes: assigned.length,
      potentialCampaignEmailsPerDay,
      liveCampaignEmailsPerDay,
      potentialNewLeadsPerDay,
      liveNewLeadsPerDay,
      productLiveNewCaps,
    },
    summary: {
      ...payload.summary,
      ready: ready.length,
      talenteraReady: ready.filter((lead) => lead.product === "talentera").length,
      evalifyReady: ready.filter((lead) => lead.product === "evalify").length,
      prepared: 0,
      today,
      tomorrow: Math.min(Math.max(0, ready.length - liveNewLeadsPerDay), liveNewLeadsPerDay),
      next48Hours: Math.min(ready.length, liveNewLeadsPerDay * 2),
      coverageDays: liveNewLeadsPerDay ? Math.ceil((ready.length / liveNewLeadsPerDay) * 10) / 10 : 0,
    },
    queue,
    preparedSamples: [],
    sequenceCatalog: {
      talentera: { arSA: canonicalTemplate("talentera_ar"), en: canonicalTemplate("talentera_en") },
      evalify: { arSA: canonicalTemplate("evalufy_ar"), en: canonicalTemplate("evalufy_en") },
    },
  };
}

function lightweightHealthPayload() {
  return {
    generatedAt: new Date().toISOString(),
    buildRef: clean(process.env.SDR_BUILD_REF) || "unknown",
    configuration: {
      apiConfigured: Boolean(clean(process.env.SMARTLEAD_API_KEY)),
      openRouterConfigured: Boolean(clean(process.env.OPENROUTER_API_KEY)),
      ownerActionsConfigured: smartleadActionAuthConfigured(),
      maritaOwnerId: "31644369",
      globalDailyNewTarget: dailyTarget(),
      minTimeBetweenEmails: Math.max(15, Number(process.env.SMARTLEAD_MIN_TIME_BETWEEN_EMAILS || 15) || 15),
      maxCampaignEmailsPerMailbox: MAX_EMAILS_PER_MAILBOX,
      autopilotEnabled: process.env.SMARTLEAD_AUTOPILOT_ENABLED !== "false",
    },
    safety: {
      healthy: false,
      recentSalesActivities: 0,
      blockedContacts: 0,
      blockedCompanies: 0,
      warnings: ["Lightweight runtime health only; live Sales safety is evaluated by the full command center and again before every Send Today/autopilot run."],
    },
    healthOnly: true,
  };
}

function degradedPayload(error: unknown) {
  const details = error instanceof Error ? error.message : "Unknown refresh error";
  const emptySequence = { subject1: "", touch1: "", subject2: "", touch2: "", subject3: "", touch3: "" };
  return {
    generatedAt: new Date().toISOString(),
    configuration: { apiConfigured: Boolean(clean(process.env.SMARTLEAD_API_KEY)), openRouterConfigured: Boolean(clean(process.env.OPENROUTER_API_KEY)), ownerActionsConfigured: smartleadActionAuthConfigured(), maritaOwnerId: "31644369", globalDailyNewTarget: dailyTarget(), minTimeBetweenEmails: 15, maxCampaignEmailsPerMailbox: MAX_EMAILS_PER_MAILBOX },
    safety: { healthy: false, recentSalesActivities: 0, blockedContacts: 0, blockedCompanies: 0, warnings: [`Live refresh failed; sending remains locked until a healthy refresh succeeds: ${details}`] },
    campaigns: { talentera: null, evalify: null }, analytics: { talentera: { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0, bounceRate: 0 }, evalify: { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0, bounceRate: 0 } },
    senders: [], capacity: { totalInboxes: 0, eligibleInboxes: 0, assignedInboxes: 0, potentialCampaignEmailsPerDay: 0, liveCampaignEmailsPerDay: 0, potentialNewLeadsPerDay: 0, liveNewLeadsPerDay: 0, productLiveNewCaps: { talentera: 0, evalify: 0 } },
    summary: { maritaCompanies: 0, emailCandidates: 0, ready: 0, talenteraReady: 0, evalifyReady: 0, blockedBySales: 0, blockedEmail: 0, alreadyEntered: 0, prepared: 0, today: 0, tomorrow: 0, next48Hours: 0, coverageDays: 0 },
    queue: [], preparedSamples: [], executions: [], sequenceCatalog: { talentera: { arSA: emptySequence, en: emptySequence }, evalify: { arSA: emptySequence, en: emptySequence } }, degraded: true, refreshError: details,
  };
}

export async function GET(request: NextRequest) {
  const browserRequest = Boolean(request.headers.get("sec-fetch-site"));
  const fullRequested = request.nextUrl.searchParams.get("view") === "full" || browserRequest;
  if (!fullRequested) return NextResponse.json(lightweightHealthPayload(), { headers: { "Cache-Control": "no-store" } });
  try {
    const payload = await canonicalOverlay(await getSmartleadV2(request.nextUrl.searchParams.get("refresh") === "1"));
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=0, must-revalidate, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("Canonical Smartlead command center refresh failed; returning fail-closed state", error);
    return NextResponse.json(degradedPayload(error), { status: 200, headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
  }
}

export async function POST(request: NextRequest) {
  if (!smartleadSameOrigin(request)) return NextResponse.json({ error: "Cross-origin Smartlead actions are blocked." }, { status: 403 });
  const auth = smartleadActionAuthorized(request); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    error: "Legacy Smartlead mutations are retired.",
    details: "Use Send today's batch for verified outreach. Campaign setup, sender reconciliation and four-lane parity are maintained automatically by the Smartlead setup workflow.",
  }, { status: 410 });
}
