import { NextRequest, NextResponse } from "next/server";
import { checkPrimeforgeInfrastructure } from "@/lib/primeforge-health";
import { smartleadActionAuthorized, smartleadSameOrigin } from "@/lib/smartlead-action-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const health = await checkPrimeforgeInfrastructure();
    return NextResponse.json(health, {
      status: health.healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      configured: Boolean(process.env.PRIMEFORGE_API_KEY),
      healthy: false,
      error: error instanceof Error ? error.message : "Primeforge health check failed.",
    }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}

export async function POST(request: NextRequest) {
  if (!smartleadSameOrigin(request)) return NextResponse.json({ error: "Cross-origin Primeforge checks are blocked." }, { status: 403 });
  const auth = smartleadActionAuthorized(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return GET();
}
