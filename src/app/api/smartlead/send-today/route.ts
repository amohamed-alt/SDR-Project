import { timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { decideRecipientLanguage } from "@/lib/recipient-language-routing";
import { getSmartleadV2, type V2Lead } from "@/lib/smartlead-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INTELLIGENCE_PATH = process.env.SMARTLEAD_V2_INTELLIGENCE_PATH || "/app/data/smartlead-v2-intelligence.json";
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

function clean(value: unknown, max = 8_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

function ownerAuthorized(request: NextRequest) {
  const configured = clean(process.env.ACQUISITION_OWNER_TOKEN, 2_000);
  if (!configured) return { ok: false as const, status: 503, error: "Owner actions are not configured on the production server." };
  const supplied = clean(request.headers.get("x-acquisition-owner-token"), 2_000);
  if (!supplied || !safeEqual(supplied, configured)) return { ok: false as const, status: 401, error: "Valid Owner key required." };
  return { ok: true as const };
}

function languageIssues(leads: V2Lead[]) {
  const issues: Array<{ contactId: string; name: string; email: string; currentLocale: string; expectedLocale: string; reason: string }> = [];
  for (const lead of leads.filter((item) => item.eligible).slice(0, 250)) {
    const expected = decideRecipientLanguage({ firstName: lead.firstName, fullName: lead.fullName, country: lead.country });
    const currentArabic = lead.locale !== "en";
    const greetingArabic = ARABIC_SCRIPT.test(lead.greetingName || "");

    if (expected.locale === "en" && lead.locale !== "en") {
      issues.push({ contactId: lead.contactId, name: lead.fullName, email: lead.email, currentLocale: lead.locale, expectedLocale: "en", reason: "Conservative deterministic routing requires English." });
      continue;
    }
    if (currentArabic && !greetingArabic) {
      issues.push({ contactId: lead.contactId, name: lead.fullName, email: lead.email, currentLocale: lead.locale, expectedLocale: expected.locale, reason: "Arabic lane requires an Arabic-script greeting name." });
      continue;
    }
    if (!currentArabic && greetingArabic) {
      issues.push({ contactId: lead.contactId, name: lead.fullName, email: lead.email, currentLocale: lead.locale, expectedLocale: "en", reason: "English lane must not use an Arabic-script greeting." });
    }
  }
  return issues;
}

async function languagePreflight() {
  let snapshot = await getSmartleadV2(true);
  let issues = languageIssues(snapshot.queue);
  let staleIntelligenceReset = false;

  // Old AI/name-analysis cache entries must never overrule the conservative
  // deterministic English fallback. If an old mismatch exists, remove the
  // cache and rebuild the queue before any Smartlead write occurs.
  if (issues.length) {
    await fs.rm(INTELLIGENCE_PATH, { force: true }).catch(() => undefined);
    staleIntelligenceReset = true;
    snapshot = await getSmartleadV2(true);
    issues = languageIssues(snapshot.queue);
  }

  return {
    snapshot,
    issues,
    staleIntelligenceReset,
    checked: snapshot.queue.filter((lead) => lead.eligible).slice(0, 250).length,
  };
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(clean(process.env.SMARTLEAD_API_KEY)) && Boolean(clean(process.env.ACQUISITION_OWNER_TOKEN)),
    smartleadConfigured: Boolean(clean(process.env.SMARTLEAD_API_KEY)),
    millionVerifierConfigured: Boolean(clean(process.env.MILLIONVERIFIER_API_KEY)),
    signalHireConfigured: Boolean(clean(process.env.SIGNALHIRE_API_KEY)),
    ownerActionsConfigured: Boolean(clean(process.env.ACQUISITION_OWNER_TOKEN)),
    languagePolicy: "Deterministic English fallback wins; Arabic requires an Arabic-script greeting and a safe GCC Arabic-name decision.",
    dailyTarget: 50,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin Smartlead daily-send actions are blocked." }, { status: 403 });
  const auth = ownerAuthorized(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const smartleadApiKey = clean(process.env.SMARTLEAD_API_KEY);
  const millionVerifierApiKey = clean(process.env.MILLIONVERIFIER_API_KEY);
  if (!smartleadApiKey) return NextResponse.json({ error: "SMARTLEAD_API_KEY is not configured on the production server." }, { status: 503 });
  if (!millionVerifierApiKey) return NextResponse.json({ error: "MILLIONVERIFIER_API_KEY is not configured on the production server." }, { status: 503 });

  try {
    const preflight = await languagePreflight();
    if (!preflight.snapshot.safety.healthy) {
      return NextResponse.json({ error: "Sales safety is not healthy. Nothing was queued.", warnings: preflight.snapshot.safety.warnings }, { status: 409 });
    }
    if (preflight.issues.length) {
      return NextResponse.json({
        error: "Language-routing preflight failed. Nothing was queued.",
        checked: preflight.checked,
        staleIntelligenceReset: preflight.staleIntelligenceReset,
        issues: preflight.issues.slice(0, 25),
      }, { status: 409 });
    }

    const orchestratorUrl = new URL("/api/smartlead/orchestrator-v3", request.nextUrl.origin);
    const response = await fetch(orchestratorUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${smartleadApiKey}`,
        "X-MillionVerifier-API-Key": millionVerifierApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "autopilot" }),
      signal: AbortSignal.timeout(280_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json({ error: "Verified daily-send engine failed.", details: payload }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      languagePreflight: {
        checked: preflight.checked,
        staleIntelligenceReset: preflight.staleIntelligenceReset,
        issues: 0,
      },
      ...payload,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Smartlead one-click daily send failed", { error });
    return NextResponse.json({ error: "Smartlead one-click daily send failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
