import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

const inputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(100),
});

function clean(value: unknown, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function workerAuthorized(request: Request) {
  const expected = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  const supplied = clean(request.headers.get("x-acquisition-worker-key"), 1000);
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function enrichmentDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Internal enrichment authorization failed." }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid marker request.", issues: parsed.error.issues }, { status: 400 });
  }

  const token = clean(process.env.HUBSPOT_PRIVATE_APP_TOKEN, 2000);
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN is not configured." }, { status: 500 });
  }

  const ids = [...new Set(parsed.data.ids.map((id) => clean(id, 100)).filter(Boolean))];
  const date = enrichmentDate();

  try {
    const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/batch/update`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: ids.map((id) => ({
          id,
          properties: { signalhire_last_enriched_at: date },
        })),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json({
        error: `HubSpot marker update failed (${response.status}).`,
        detail: body.slice(0, 700),
      }, { status: 502 });
    }

    return NextResponse.json({ status: "completed", marked: ids.length, date }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "SignalHire marker update failed.",
    }, { status: 500 });
  }
}
