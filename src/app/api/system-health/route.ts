import { NextResponse } from "next/server";
import { getSystemHealth } from "@/lib/system-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function GET() {
  const health = await getSystemHealth();
  return NextResponse.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: NO_CACHE_HEADERS,
  });
}
