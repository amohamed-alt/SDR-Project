import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configured(value: string | undefined) {
  return Boolean(String(value || "").trim());
}

export async function GET() {
  const smartleadConfigured = configured(process.env.SMARTLEAD_API_KEY);
  const openRouterConfigured = configured(process.env.OPENROUTER_API_KEY);

  return NextResponse.json(
    {
      ok: smartleadConfigured && openRouterConfigured,
      configured: smartleadConfigured,
      openRouterConfigured,
      autopilotEnabled: process.env.SMARTLEAD_AUTOPILOT_ENABLED !== "false",
      timezone: "Asia/Riyadh",
      sendWindow: {
        start: String(process.env.SMARTLEAD_START_HOUR || "09:30"),
        end: String(process.env.SMARTLEAD_END_HOUR || "16:30"),
      },
      minTimeBetweenEmails: Math.max(15, Number(process.env.SMARTLEAD_MIN_TIME_BETWEEN_EMAILS || 15) || 15),
      dailyNewLeadTarget: Number(process.env.SMARTLEAD_DAILY_NEW_LEADS || 75),
      buildRef: String(process.env.SDR_BUILD_REF || "unknown"),
      timestamp: new Date().toISOString(),
    },
    {
      status: smartleadConfigured && openRouterConfigured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
