import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    sessionConfigured: false,
    signalHireConfigured: Boolean(process.env.SIGNALHIRE_API_KEY),
    maxResults: 50,
    mode: "chrome_companion",
    legacyHeadlessDisabled: true,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  return NextResponse.json({
    error: "VPS-based LinkedIn session replay is disabled for account safety. Use the Chrome Companion instead.",
    status: "chrome_companion_required",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
