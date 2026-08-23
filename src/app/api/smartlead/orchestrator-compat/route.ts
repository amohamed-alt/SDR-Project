import { NextRequest } from "next/server";
import { GET as orchestratorGet, POST as orchestratorPost } from "../orchestrator/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

function isSmartleadScheduleRequest(input: RequestInfo | URL) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return /server\.smartlead\.ai\/api\/v1\/campaigns\/\d+\/schedule/i.test(url);
}

function normalizeScheduleBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!("max_new_leads_per_day" in parsed) && "max_leads_per_day" in parsed) {
      parsed.max_new_leads_per_day = parsed.max_leads_per_day;
    }
    delete parsed.max_leads_per_day;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export async function GET() {
  return orchestratorGet();
}

export async function POST(request: NextRequest) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isSmartleadScheduleRequest(input)) return originalFetch(input, init);
    return originalFetch(input, { ...init, body: normalizeScheduleBody(init?.body) });
  };

  try {
    return await orchestratorPost(request);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
