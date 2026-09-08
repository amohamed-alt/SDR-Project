import { NextRequest, NextResponse } from "next/server";
import { getCompanionFullRun, getLatestCompanionFullRun, listCompanionFullRuns } from "@/lib/salesnav-companion";
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

  const requestedId = String(request.nextUrl.searchParams.get("id") || "").trim();
  const [run, history] = await Promise.all([
    requestedId ? getCompanionFullRun(requestedId) : getLatestCompanionFullRun(),
    listCompanionFullRuns(100),
  ]);

  return NextResponse.json({
    ok: true,
    run: run ? { ...run, total: run.leads.length } : null,
    history,
  }, { headers: { "Cache-Control": "no-store" } });
}
