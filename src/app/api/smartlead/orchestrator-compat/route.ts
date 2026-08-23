import { NextRequest } from "next/server";
import { GET as orchestratorGet, POST as orchestratorPost } from "../orchestrator/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function isSmartleadScheduleRequest(input: RequestInfo | URL) {
  return /server\.smartlead\.ai\/api\/v1\/campaigns\/\d+\/schedule/i.test(requestUrl(input));
}

function isSmartleadSequenceRequest(input: RequestInfo | URL) {
  return /server\.smartlead\.ai\/api\/v1\/campaigns\/\d+\/sequences/i.test(requestUrl(input));
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

function normalizeSequenceBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return body;
  try {
    const raw = JSON.parse(body) as unknown;
    const rows = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { sequences?: unknown[] }).sequences)
        ? (raw as { sequences: unknown[] }).sequences
        : null;
    if (!rows) return body;

    const sequences = rows.map((value) => {
      const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const variants = Array.isArray(row.variants) ? row.variants : [];
      const firstVariant = variants[0] && typeof variants[0] === "object" ? variants[0] as Record<string, unknown> : {};
      return {
        id: row.id ?? null,
        seq_number: row.seq_number,
        subject: row.subject ?? firstVariant.subject ?? "",
        email_body: row.email_body ?? firstVariant.email_body ?? "",
        seq_delay_details: row.seq_delay_details,
      };
    });

    return JSON.stringify({ sequences });
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
    if (isSmartleadScheduleRequest(input)) {
      return originalFetch(input, { ...init, body: normalizeScheduleBody(init?.body) });
    }
    if (isSmartleadSequenceRequest(input) && String(init?.method || "GET").toUpperCase() === "POST") {
      return originalFetch(input, { ...init, body: normalizeSequenceBody(init?.body) });
    }
    return originalFetch(input, init);
  };

  try {
    return await orchestratorPost(request);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
