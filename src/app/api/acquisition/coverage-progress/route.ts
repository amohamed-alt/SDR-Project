import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markAcquisitionCoveragePage, readAcquisitionCoverageProgress } from "@/lib/acquisition-coverage-progress";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ page: z.number().int().min(1).max(500) });

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function GET() {
  const progress = await readAcquisitionCoverageProgress();
  return NextResponse.json(progress, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site progress updates are not allowed." }, { status: 403 });
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Admin authorization is required." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid coverage progress update." }, { status: 400 });
  const progress = await markAcquisitionCoveragePage(parsed.data.page);
  return NextResponse.json(progress, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
