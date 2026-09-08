import { NextRequest, NextResponse } from "next/server";
import { getLatestCompanionFullRun } from "@/lib/salesnav-companion";
import { SALESNAV_SETUP_COOKIE, verifySalesNavSetupKey } from "@/lib/salesnav-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unlocked(request: NextRequest) {
  return verifySalesNavSetupKey(request.cookies.get(SALESNAV_SETUP_COOKIE)?.value || "");
}

export async function GET(request: NextRequest) {
  if (!unlocked(request)) {
    return NextResponse.json({ error: "Unlock Sales Nav admin settings first." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const run = await getLatestCompanionFullRun();
  if (!run) {
    return NextResponse.json({ ok: true, run: null }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    ok: true,
    run: {
      ...run,
      total: run.leads.length,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
