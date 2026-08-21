import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { batchRead, searchAll } from "@/lib/hubspot";
import {
  buildCompanyPropertyRepairs,
  normalizeCompanyDomain,
  propertiesToApply,
  REPAIRABLE_COMPANY_PROPERTIES,
} from "@/lib/company-property-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE_URL = process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/intelligence-detect";
const ENGINE_TIMEOUT_MS = Math.max(10_000, Number(process.env.CAREER_ENGINE_TIMEOUT_MS || 180_000));
const AUDIT_PATH = process.env.COMPANY_ENRICHMENT_AUDIT_PATH || "/app/data/company-enrichment-audit.jsonl";

const HUBSPOT_FIELDS = ["name", ...REPAIRABLE_COMPANY_PROPERTIES] as const;

type CareerEngineResponse = {
  ok?: boolean;
  duration_ms?: number;
  result?: {
    career_status?: string;
    career_url?: string;
    career_confidence_score?: number;
    career_evidence_reason?: string;
    career_evidence_url?: string;
    ats_status?: string;
    detected_ats?: string;
    ats_confidence?: string;
    ats_evidence_url?: string;
    ats_evidence_reason?: string;
    detection_method?: string;
    playwright_used?: boolean;
  };
  error?: string;
};

function clean(value: unknown, max = 1500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function hubspotCompanyUrl(companyId: string) {
  const portalId = process.env.HUBSPOT_PORTAL_ID || "145742477";
  const host = process.env.HUBSPOT_UI_DOMAIN || "app-eu1.hubspot.com";
  return `https://${host}/contacts/${portalId}/company/${companyId}`;
}

async function findCompany(domain: string) {
  const exact = await searchAll("companies", HUBSPOT_FIELDS, [{ propertyName: "domain", operator: "EQ", value: domain }]);
  if (exact[0]) return exact[0];
  try {
    const website = await searchAll("companies", HUBSPOT_FIELDS, [{ propertyName: "company_website", operator: "CONTAINS_TOKEN", value: domain }]);
    return website[0] || null;
  } catch {
    return null;
  }
}

async function callCareerEngine(input: {
  companyName: string;
  domain: string;
  website: string;
  knownCareerUrl: string;
  forceRefresh: boolean;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  try {
    const response = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: input.companyName,
        company_domain: input.domain,
        company_website: input.website,
        known_career_url: input.knownCareerUrl || undefined,
        detect_ats: true,
        career_only: false,
        stop_on_career: false,
        require_job_detail: false,
        force_browser: Boolean(input.knownCareerUrl),
        force_refresh: input.forceRefresh,
        max_static_pages: 36,
        max_browser_steps: 12,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as CareerEngineResponse;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Career engine returned HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function token() {
  const value = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!value) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return value;
}

async function patchCompany(companyId: string, properties: Record<string, string>) {
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(companyId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HubSpot company update failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
}

async function appendAudit(entry: Record<string, unknown>) {
  await fs.mkdir(path.dirname(AUDIT_PATH), { recursive: true });
  await fs.appendFile(AUDIT_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

async function analyze(domainInput: string, forceRefresh: boolean) {
  const domain = normalizeCompanyDomain(domainInput);
  if (!domain || !domain.includes(".")) throw new Error("Enter a valid company domain.");
  const found = await findCompany(domain);
  if (!found) return { domain, found: false as const };

  const companyId = String(found.id);
  const current = (await batchRead("companies", [companyId], HUBSPOT_FIELDS))[0] || found;
  const properties = current.properties || {};
  const companyName = clean(properties.name, 250) || domain;
  const currentDomain = normalizeCompanyDomain(clean(properties.domain)) || domain;
  const storedWebsite = clean(properties.company_website);
  const canonicalWebsite = `https://${currentDomain}`;
  const engineWebsite = storedWebsite && normalizeCompanyDomain(storedWebsite) === currentDomain ? storedWebsite : canonicalWebsite;
  const knownCareerUrl = clean(properties.career_page_url);
  const engine = await callCareerEngine({ companyName, domain: currentDomain, website: engineWebsite, knownCareerUrl, forceRefresh });
  const result = engine.result || {};
  const confidence = Math.max(0, Math.min(100, Number(result.career_confidence_score || 0)));
  const careerUrl = clean(result.career_url || knownCareerUrl);
  const detectedAts = clean(result.detected_ats);
  const evidenceUrl = clean(result.ats_evidence_url || result.career_evidence_url || careerUrl);
  const evidenceReason = clean(result.ats_evidence_reason || result.career_evidence_reason || "Verified by Career + ATS Intelligence.", 1000);
  const careerVerified = clean(result.career_status) === "found_verified" && confidence >= 90;

  const suggested = {
    domain: currentDomain,
    company_website: canonicalWebsite,
    career_page_url: careerVerified ? careerUrl : "",
    detected_ats: detectedAts,
    ats_status: detectedAts ? "detected" : clean(result.ats_status),
    ats_confidence: detectedAts ? clean(result.ats_confidence) : "",
    ats_evidence_url: detectedAts ? evidenceUrl : "",
    ats_evidence_reason: detectedAts ? evidenceReason : "",
    career_portal_type: careerVerified ? (detectedAts ? "vendor_hosted_portal" : "basic_jobs_page") : "",
  };

  const repairs = buildCompanyPropertyRepairs({
    current: properties,
    suggested,
    confidence,
    evidence: evidenceUrl || evidenceReason,
  });

  return {
    domain,
    found: true as const,
    company: {
      id: companyId,
      name: companyName,
      hubspotUrl: hubspotCompanyUrl(companyId),
    },
    intelligence: {
      status: clean(result.career_status),
      confidence,
      careerPageUrl: careerUrl,
      detectedAts,
      atsConfidence: clean(result.ats_confidence),
      evidenceUrl,
      evidenceReason,
      detectionMethod: clean(result.detection_method),
      playwrightUsed: Boolean(result.playwright_used),
      durationMs: Number(engine.duration_ms || 0),
    },
    repairs,
    summary: {
      fills: repairs.filter((item) => item.disposition === "fill").length,
      conflicts: repairs.filter((item) => item.disposition === "conflict").length,
      unchanged: repairs.filter((item) => item.disposition === "same").length,
      autoApplicable: repairs.filter((item) => item.canAutoApply).length,
    },
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: "domain-to-hubspot-repair",
    safeByDefault: true,
    repairableProperties: REPAIRABLE_COMPANY_PROPERTIES,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === "push" ? "push" : "analyze";
    const domain = clean(body.domain, 500);
    const forceRefresh = body.forceRefresh === true;
    const overwriteConflicts = body.overwriteConflicts === true;
    if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });
    if (process.env.DEMO_MODE === "true") return NextResponse.json({ error: "Company enrichment is disabled in DEMO_MODE." }, { status: 503 });

    const analysis = await analyze(domain, forceRefresh || action === "push");
    if (!analysis.found) return NextResponse.json({ error: `No HubSpot company found for ${analysis.domain}.`, analysis }, { status: 404 });
    if (action === "analyze") return NextResponse.json({ analysis }, { headers: { "Cache-Control": "no-store" } });

    const properties = propertiesToApply(analysis.repairs, overwriteConflicts);
    if (Object.keys(properties).length) await patchCompany(analysis.company.id, properties);
    await appendAudit({
      at: new Date().toISOString(),
      action: "push",
      domain: analysis.domain,
      companyId: analysis.company.id,
      overwriteConflicts,
      properties,
      conflicts: analysis.repairs.filter((item) => item.disposition === "conflict").map((item) => ({ property: item.property, currentValue: item.currentValue, suggestedValue: item.suggestedValue })),
      intelligence: analysis.intelligence,
    });

    const reread = (await batchRead("companies", [analysis.company.id], HUBSPOT_FIELDS))[0];
    return NextResponse.json({
      pushed: Object.keys(properties),
      skippedConflicts: analysis.repairs.filter((item) => item.disposition === "conflict" && !properties[item.property]).map((item) => item.property),
      company: reread || null,
      analysis,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Company enrichment failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Company enrichment failed." }, { status: 500 });
  }
}