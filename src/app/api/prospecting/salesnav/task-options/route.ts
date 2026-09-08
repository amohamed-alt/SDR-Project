import { NextRequest, NextResponse } from "next/server";
import { manualTaskOwners } from "@/lib/acquisition-routing";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { SALESNAV_SETUP_COOKIE, verifySalesNavSetupKey } from "@/lib/salesnav-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function salesNavUnlocked(request: NextRequest) {
  return verifySalesNavSetupKey(request.cookies.get(SALESNAV_SETUP_COOKIE)?.value || "");
}

export async function GET(request: NextRequest) {
  if (!sdrAdminAuthorized(request) && !salesNavUnlocked(request)) {
    return NextResponse.json({ error: "Unlock Sales Nav setup or SDR admin access first." }, { status: 401 });
  }
  const owners = manualTaskOwners().map((owner) => ({ id: owner.id, name: owner.name }));
  const defaultOwner = owners.find((owner) => owner.id === "31644369") || owners[0] || null;
  return NextResponse.json({
    ok: true,
    owners,
    defaultOwner,
    defaultTime: "09:00",
  }, { headers: { "Cache-Control": "no-store" } });
}
