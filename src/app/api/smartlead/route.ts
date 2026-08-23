import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function ownerAuthorized(request: NextRequest) {
  const configured = clean(process.env.ACQUISITION_OWNER_TOKEN, 2_000);
  if (!configured) return { ok: false as const, status: 503, error: "Owner actions are not configured on the production server." };
  const supplied = clean(request.headers.get("x-acquisition-owner-token"), 2_000);
  if (!supplied || !safeEqual(supplied, configured)) return { ok: false as const, status: 401, error: "Valid Owner key required." };
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  try {
    const payload = await getSmartleadV2(request.nextUrl.searchParams.get("refresh") === "1");
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=0, must-revalidate, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("Smartlead V2 command center load failed", error);
    return NextResponse.json({ error: "Unable to load Smartlead command center", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin Smartlead actions are blocked." }, { status: 403 });
  const auth = ownerAuthorized(request); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
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
