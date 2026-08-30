import { NextRequest, NextResponse } from "next/server";
import { acquisitionOwners } from "@/lib/acquisition-routing";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  }

  return NextResponse.json({
    owners: acquisitionOwners().map((owner) => ({ id: owner.id, name: owner.name })),
  }, { headers: { "Cache-Control": "no-store" } });
}
