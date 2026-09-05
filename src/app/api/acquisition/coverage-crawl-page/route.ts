import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as coveragePost } from "@/app/api/acquisition/coverage/route";
import { markAcquisitionCoveragePage } from "@/lib/acquisition-coverage-progress";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ page: z.number().int().min(2).max(89) });

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site crawl actions are not allowed." }, { status: 403 });
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Admin authorization is required." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Apollo crawl page." }, { status: 400 });

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  const delegated = new NextRequest(`${request.nextUrl.origin}/api/acquisition/coverage`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "discover",
      startPage: parsed.data.page,
      pages: 1,
      confirmCredits: true,
    }),
  });
  const response = await coveragePost(delegated);
  const result = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) return NextResponse.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });

  let checkpointWarning = "";
  try {
    await markAcquisitionCoveragePage(parsed.data.page);
  } catch (error) {
    checkpointWarning = error instanceof Error ? error.message : "Checkpoint write failed.";
  }

  return NextResponse.json({
    ...result,
    crawlPage: parsed.data.page,
    signalHireContactCreditsUsed: 0,
    checkpointed: !checkpointWarning,
    checkpointWarning,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
