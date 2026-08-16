import { NextRequest, NextResponse } from "next/server";
import { refreshHiringSignals } from "@/lib/hiring-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isInternalRequest(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const forwardedHost = request.headers.get("x-forwarded-host");
  return !forwardedHost && ["sdr-dashboard", "127.0.0.1", "localhost"].includes(host);
}

export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Hiring refresh is restricted to the internal Docker network." }, { status: 403 });
  }

  try {
    const store = await refreshHiringSignals();
    return NextResponse.json({
      ok: true,
      generatedAt: store.generatedAt,
      run: store.run,
      cursor: store.cursor,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Hiring intelligence refresh failed", error);
    return NextResponse.json({
      error: "Unable to refresh hiring intelligence",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
