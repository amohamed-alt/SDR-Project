import { NextRequest, NextResponse } from "next/server";
import { smartleadActionAuthorized, smartleadSameOrigin } from "@/lib/smartlead-action-auth";
import { VISIBLE_SEQUENCE_LANES } from "@/lib/smartlead-visible-sequences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
type JsonObject = Record<string, unknown>;

function clean(value: unknown, max = 2_000) { return String(value ?? "").trim().slice(0, max); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function list(value: unknown, keys: string[] = []) { if (Array.isArray(value)) return value; const item = object(value); for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[]; return [] as unknown[]; }

async function request(endpoint: string, init: RequestInit = {}) {
  const apiKey = clean(process.env.SMARTLEAD_API_KEY, 8_000);
  if (!apiKey) throw new Error("SMARTLEAD_API_KEY is not configured.");
  const params = new URLSearchParams({ api_key: apiKey });
  const response = await fetch(`${SMARTLEAD_API}${endpoint}?${params}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Smartlead ${endpoint} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : await response.json() as unknown;
}

export async function POST(requestObject: NextRequest) {
  if (!smartleadSameOrigin(requestObject)) return NextResponse.json({ error: "Cross-origin Smartlead actions are blocked." }, { status: 403 });
  const auth = smartleadActionAuthorized(requestObject); if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const canonical = new Set(Object.values(VISIBLE_SEQUENCE_LANES).map((lane) => lane.campaignName));
    const payload = await request("/campaigns/");
    const managed = list(payload, ["campaigns", "data"]).map(object).filter((item) => /Marita SDR/i.test(clean(item.name)));
    const legacy = managed.filter((item) => !canonical.has(clean(item.name)));
    const retired: Array<{ id: number; name: string; previousStatus: string; action: string }> = [];

    for (const row of legacy) {
      const id = Number(row.id); if (!Number.isFinite(id)) continue;
      const name = clean(row.name); const status = clean(row.status).toUpperCase() || "UNKNOWN";
      if (["DRAFTED", "PAUSED", "COMPLETED", "STOPPED"].includes(status)) {
        retired.push({ id, name, previousStatus: status, action: "already-non-sending" });
        continue;
      }
      await request(`/campaigns/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: "PAUSED" }) });
      retired.push({ id, name, previousStatus: status, action: "paused" });
    }

    return NextResponse.json({
      ok: true,
      canonicalCampaigns: [...canonical],
      managedCampaigns: managed.length,
      legacyCampaigns: legacy.length,
      retired,
      policy: "Only the four canonical Talentera/Evalufy Arabic/English campaigns may send Marita SDR outreach.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Legacy Smartlead reconciliation failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
