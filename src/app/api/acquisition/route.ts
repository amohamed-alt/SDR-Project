import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { buildAcquisitionDashboard, createMockAcquisitionDashboard } from "@/lib/acquisition";

export const runtime = "nodejs";
export const maxDuration = 120;

const cachedAcquisition = unstable_cache(
  buildAcquisitionDashboard,
  ["talentera-acquisition-dashboard-v1"],
  { revalidate: 900, tags: ["acquisition-dashboard"] },
);

export async function GET(request: NextRequest) {
  try {
    const data = process.env.DEMO_MODE === "true"
      ? createMockAcquisitionDashboard()
      : request.nextUrl.searchParams.get("refresh") === "1"
        ? await buildAcquisitionDashboard()
        : await cachedAcquisition();
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("Acquisition dashboard load failed", error);
    return NextResponse.json({
      error: "Unable to load Acquisition dashboard data",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
