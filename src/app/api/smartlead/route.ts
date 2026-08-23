import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { smartleadActionAuthConfigured, smartleadActionAuthorized, smartleadSameOrigin } from "@/lib/smartlead-action-auth";
import {
  analyzeRecipientNames,
  bootstrapSmartleadV2,
  getSmartleadV2,
  launchPreparedSmartleadV2,
  prepareSmartleadV2,
  setSmartleadV2Status,
  syncSmartleadV2Senders,
} from "@/lib/smartlead-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bootstrap") }),
  z.object({ action: z.literal("sync_senders") }),
  z.object({ action: z.literal("analyze_names"), limit: z.number().int().min(1).max(250).optional() }),
  z.object({ action: z.literal("prepare"), limit: z.number().int().min(1).max(150).optional() }),
  z.object({ action: z.literal("launch"), confirm: z.literal("QUEUE_MARITA_BATCH") }),
  z.object({ action: z.literal("status"), product: z.enum(["talentera", "evalify", "all"]), status: z.enum(["START", "PAUSED"]), confirm: z.literal("CHANGE_CAMPAIGN_STATUS") }),
]);

function clean(value: unknown, max = 2_000) { return String(value ?? "").trim().slice(0, max); }

function lightweightHealthPayload() {
  return {
    generatedAt: new Date().toISOString(),
    buildRef: clean(process.env.SDR_BUILD_REF) || "unknown",
    configuration: {
      apiConfigured: Boolean(clean(process.env.SMARTLEAD_API_KEY)),
      openRouterConfigured: Boolean(clean(process.env.OPENROUTER_API_KEY)),
      ownerActionsConfigured: smartleadActionAuthConfigured(),
      maritaOwnerId: "31644369",
      globalDailyNewTarget: Number(process.env.SMARTLEAD_DAILY_NEW_LEADS || 50),
      minTimeBetweenEmails: Math.max(15, Number(process.env.SMARTLEAD_MIN_TIME_BETWEEN_EMAILS || 15) || 15),
      maxCampaignEmailsPerMailbox: 20,
      autopilotEnabled: process.env.SMARTLEAD_AUTOPILOT_ENABLED === "true",
    },
    safety: {
      healthy: false,
      recentSalesActivities: 0,
      blockedContacts: 0,
      blockedCompanies: 0,
      warnings: ["Lightweight runtime health only; live Sales safety is evaluated by the full command center and again before every automatic queue."],
    },
    healthOnly: true,
  };
}

function degradedPayload(error: unknown) {
  const details = error instanceof Error ? error.message : "Unknown refresh error";
  const emptySequence = { subject1: "", touch1: "", subject2: "", touch2: "", subject3: "", touch3: "" };
  return {
    generatedAt: new Date().toISOString(),
    configuration: {
      apiConfigured: Boolean(clean(process.env.SMARTLEAD_API_KEY)),
      openRouterConfigured: Boolean(clean(process.env.OPENROUTER_API_KEY)),
      ownerActionsConfigured: smartleadActionAuthConfigured(),
      maritaOwnerId: "31644369",
      globalDailyNewTarget: Number(process.env.SMARTLEAD_DAILY_NEW_LEADS || 50),
      minTimeBetweenEmails: Math.max(15, Number(process.env.SMARTLEAD_MIN_TIME_BETWEEN_EMAILS || 15) || 15),
      maxCampaignEmailsPerMailbox: 20,
    },
    safety: {
      healthy: false,
      recentSalesActivities: 0,
      blockedContacts: 0,
      blockedCompanies: 0,
      warnings: [`Live refresh failed; all write actions remain locked until a healthy refresh succeeds: ${details}`],
    },
    campaigns: { talentera: null, evalify: null },
    analytics: {
      talentera: { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0, bounceRate: 0 },
      evalify: { sent: 0, replies: 0, bounces: 0, unsubscribed: 0, activeLeads: 0, bounceRate: 0 },
    },
    senders: [],
    capacity: {
      totalInboxes: 0,
      eligibleInboxes: 0,
      assignedInboxes: 0,
      potentialCampaignEmailsPerDay: 0,
      liveCampaignEmailsPerDay: 0,
      potentialNewLeadsPerDay: 0,
      liveNewLeadsPerDay: 0,
      productLiveNewCaps: { talentera: 0, evalify: 0 },
    },
    summary: {
      maritaCompanies: 0,
      emailCandidates: 0,
      ready: 0,
      talenteraReady: 0,
      evalifyReady: 0,
      blockedBySales: 0,
      blockedEmail: 0,
      alreadyEntered: 0,
      prepared: 0,
      today: 0,
      tomorrow: 0,
      next48Hours: 0,
      coverageDays: 0,
    },
    queue: [],
    preparedSamples: [],
    executions: [],
    sequenceCatalog: {
      talentera: { arSA: emptySequence, en: emptySequence },
      evalify: { arSA: emptySequence, en: emptySequence },
    },
    degraded: true,
    refreshError: details,
  };
}

export async function GET(request: NextRequest) {
  const browserRequest = Boolean(request.headers.get("sec-fetch-site"));
  const fullRequested = request.nextUrl.searchParams.get("view") === "full" || browserRequest;
  if (!fullRequested) {
    return NextResponse.json(lightweightHealthPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const payload = await getSmartleadV2(request.nextUrl.searchParams.get("refresh") === "1");
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=0, must-revalidate, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("Smartlead V2 command center live refresh failed; returning fail-closed degraded state", error);
    return NextResponse.json(degradedPayload(error), {
      status: 200,
      headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  }
}

export async function POST(request: NextRequest) {
  if (!smartleadSameOrigin(request)) return NextResponse.json({ error: "Cross-origin Smartlead actions are blocked." }, { status: 403 });
  const auth = smartleadActionAuthorized(request); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({}))); if (!parsed.success) return NextResponse.json({ error: "Invalid Smartlead action", details: parsed.error.flatten() }, { status: 400 });
  try {
    if (parsed.data.action === "bootstrap") return NextResponse.json({ ok: true, ...(await bootstrapSmartleadV2()) });
    if (parsed.data.action === "sync_senders") return NextResponse.json({ ok: true, ...(await syncSmartleadV2Senders()) });
    if (parsed.data.action === "analyze_names") return NextResponse.json({ ok: true, ...(await analyzeRecipientNames(parsed.data.limit)) });
    if (parsed.data.action === "prepare") return NextResponse.json({ ok: true, ...(await prepareSmartleadV2(parsed.data.limit)) });
    if (parsed.data.action === "launch") return NextResponse.json({ ok: true, ...(await launchPreparedSmartleadV2()) });
    return NextResponse.json({ ok: true, ...(await setSmartleadV2Status(parsed.data.product, parsed.data.status)) });
  } catch (error) {
    console.error("Smartlead V2 action failed", { action: parsed.data.action, error });
    return NextResponse.json({ error: "Smartlead action failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
