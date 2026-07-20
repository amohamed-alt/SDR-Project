import { gzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { createMockAcquisitionDashboard } from "@/lib/acquisition";
import { getAcquisitionSnapshot } from "@/lib/acquisition-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function acquisitionResponse(
  request: NextRequest,
  serialized: string,
  headers: Record<string, string>,
) {
  const responseHeaders = {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Accept-Encoding",
    ...headers,
  };

  const acceptsGzip = request.headers.get("accept-encoding")?.includes("gzip");
  if (acceptsGzip && serialized.length > 1_024) {
    const compressed = gzipSync(serialized, { level: 6 });
    return new NextResponse(new Uint8Array(compressed), {
      headers: {
        ...responseHeaders,
        "Content-Encoding": "gzip",
        "Content-Length": String(compressed.byteLength),
      },
    });
  }

  return new NextResponse(serialized, {
    headers: {
      ...responseHeaders,
      "Content-Length": String(Buffer.byteLength(serialized)),
    },
  });
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  try {
    if (process.env.DEMO_MODE === "true") {
      const data = createMockAcquisitionDashboard();
      return acquisitionResponse(request, JSON.stringify(data), {
        "X-Acquisition-Source": "demo",
        "X-Acquisition-Refresh": "idle",
        "Server-Timing": `acquisition;dur=${Date.now() - startedAt}`,
      });
    }

    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const wait = request.nextUrl.searchParams.get("wait") === "1";
    const snapshot = await getAcquisitionSnapshot({ refresh, wait });

    return acquisitionResponse(request, snapshot.serialized, {
      "X-Acquisition-Source": snapshot.source,
      "X-Acquisition-Age": String(snapshot.ageSeconds),
      "X-Acquisition-Refresh": snapshot.refreshState,
      ...(snapshot.lastError ? { "X-Acquisition-Refresh-Error": snapshot.lastError.slice(0, 300) } : {}),
      "Server-Timing": `acquisition;dur=${Date.now() - startedAt}`,
    });
  } catch (error) {
    console.error("Acquisition dashboard load failed", error);
    return NextResponse.json({
      error: "Unable to load Acquisition dashboard data",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
