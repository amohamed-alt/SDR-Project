import { NextRequest, NextResponse } from "next/server";
import { reclassifyStoredAcquisitionCoverage } from "@/lib/acquisition-data-api";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "coverage-ledger-v3";

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function GET() {
  return NextResponse.json({
    version: VERSION,
    zeroCredit: true,
    policy: "Reclassifies only already-stored Postgres coverage rows. No Apollo, SignalHire, or HubSpot provider calls are made.",
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site actions are not allowed." }, { status: 403 });
    if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Admin authorization is required." }, { status: 401 });
    const result = await reclassifyStoredAcquisitionCoverage();
    return NextResponse.json({
      version: VERSION,
      zeroCredit: true,
      ...result,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Coverage reclassification failed.",
    }, { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
