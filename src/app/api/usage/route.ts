import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const usageApi = String(process.env.DASHBOARD_CACHE_API_URL || "").replace(/\/$/, "");

const eventSchema = z.object({
  visitorId: z.string().min(8).max(96).regex(/^[A-Za-z0-9_-]+$/),
  sessionId: z.string().min(8).max(96).regex(/^[A-Za-z0-9_-]+$/),
  displayName: z.string().trim().min(1).max(80),
  eventType: z.string().trim().min(1).max(80),
  path: z.string().max(500).default("/"),
  feature: z.string().max(120).default("dashboard"),
  meta: z.record(z.string(), z.unknown()).default({}),
});

const DISABLED_PAYLOAD = {
  tracking: false,
  database: "disabled",
  metrics: {
    activeNow: 0,
    uniqueUsersToday: 0,
    sessionsToday: 0,
    opensToday: 0,
    eventsToday: 0,
    avgSessionMinutes: 0,
  },
  users: [],
  topFeatures: [],
};

function disabled(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ...DISABLED_PAYLOAD, ...extra }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET() {
  if (!usageApi || process.env.DEMO_MODE === "true") return disabled();

  try {
    const response = await fetch(`${usageApi}/v1/usage/summary`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Usage API returned HTTP ${response.status}`);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.warn("Usage analytics summary unavailable", error);
    return disabled({ unavailable: true });
  }
}

export async function POST(request: NextRequest) {
  if (!usageApi || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ status: "ignored", tracking: false });
  }

  const body = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid usage event", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const response = await fetch(`${usageApi}/v1/usage/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json(payload, { status: response.status });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("Usage event write failed", error);
    return NextResponse.json({ status: "deferred", tracking: false }, { status: 202 });
  }
}
