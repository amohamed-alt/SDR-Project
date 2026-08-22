import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { POST as autorunPost } from "@/app/api/acquisition/autorun/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKER_PATH = process.env.ACQUISITION_BOOTSTRAP_MARKER_PATH || "/app/data/acquisition-bootstrap-approved-2026-08-22.json";

async function completedMarker() {
  try {
    const raw = await readFile(MARKER_PATH, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const existing = await completedMarker();
  if (existing) {
    return NextResponse.json({
      status: "already_completed",
      marker: existing,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const response = await autorunPost(request);
  if (!response.ok) return response;

  const snapshot = await response.clone().json() as Record<string, unknown>;
  await mkdir(dirname(MARKER_PATH), { recursive: true });
  await writeFile(MARKER_PATH, JSON.stringify({
    version: "approved-apollo-seed-2026-08-22-v1",
    completedAt: new Date().toISOString(),
    result: snapshot,
  }, null, 2), "utf8");

  return response;
}
