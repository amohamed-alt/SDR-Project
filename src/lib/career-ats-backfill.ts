import { batchRead, searchAll } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

const ENGINE_URL = process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/intelligence-detect";
const ENGINE_TIMEOUT_MS = Math.max(30_000, Number(process.env.CAREER_ENGINE_TIMEOUT_MS || 180_000));
const DEFAULT_BATCH_LIMIT = Math.max(1, Math.min(100, Number(process.env.CAREER_BACKFILL_BATCH_LIMIT || 50)));
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.CAREER_SCAN_CONCURRENCY || 6)));
const FINAL_SEARCH_STATUSES = new Set(["completed", "needs review"]);

const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "website",
  "company_website",
  "career_page_url",
  "career_portal_type",
  "detected_ats",
  "ats_status",
  "ats_confidence",
  "ats_evidence_url",
  "ats_evidence_reason",
  "search_status",
] as const;

interface EngineResult {
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
  pages_checked?: number;
  static_pages_checked?: number;
  browser_pages_checked?: number;
  playwright_used?: boolean;
  detection_error?: string;
}

interface EngineResponse {
  ok?: boolean;
  duration_ms?: number;
  result?: EngineResult;
  error?: string;
}

export interface CareerAtsBackfillItem {
  companyId: string;
  companyName: string;
  previousSearchStatus: string;
  searchStatus: "Completed" | "Needs Review" | "Skipped" | "Error";
  careerPageUrl: string;
  detectedAts: string;
  atsStatus: string;
  atsConfidence: string;
  evidenceUrl: string;
  reason: string;
  decision: string;
  pagesChecked: number;
  browserPagesChecked: number;
  playwrightUsed: boolean;
  hubspotVerified: boolean;
  durationMs: number;
}

export interface CareerAtsBackfillSummary {
  eligibleBefore: number;
  selected: number;
  processed: number;
  completed: number;
  needsReview: number;
  skipped: number;
  errors: number;
  hubspotVerified: number;
  remainingEligible: number;
}

function value(record: HubSpotRecord, property: string) {
  return String(record.properties[property] || "").trim();
}

function normalizeDomain(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return input.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

function normalizeWebsite(raw: string, domain: string, careerPageUrl: string) {
  const input = String(raw || "").trim();
  if (input) return /^https?:\/\//i.test(input) ? input : `https://${input}`;
  if (domain) return `https://${domain}`;
  return careerPageUrl || "";
}

function normalizeAts(raw: string) {
  const input = String(raw || "").trim();
  const lower = input.toLowerCase();
  if (!input) return "";
  if (lower === "hyrdd" || lower.includes("kabi hyrdd") || lower.includes("hyrdd by kabi")) return "KABi";
  if (["oracle recruiting", "oracle recruiting cloud", "oracle hcm", "oracle hcm cloud"].includes(lower)) return "Oracle HCM Cloud";
  if (lower === "taleo") return "Oracle Taleo";
  if (lower === "adrenalin max") return "Adrenalin";
  return input;
}

function isWeakAts(raw: string) {
  const normalized = normalizeAts(raw).toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  return [
    "unknown",
    "unclear",
    "custom",
    "not detected",
    "not_detected",
    "no visible ats",
    "no ats",
    "none",
    "n/a",
    "na",
  ].includes(normalized);
}

function isFinalSearchStatus(raw: string) {
  return FINAL_SEARCH_STATUSES.has(String(raw || "").trim().toLowerCase());
}

function sameAts(a: string, b: string) {
  return normalizeAts(a).toLowerCase() === normalizeAts(b).toLowerCase();
}

function isPlaceholderCompany(name: string) {
  const normalized = name.trim().toLowerCase();
  return !normalized || [
    "-",
    "(no value)",
    "no",
    "na",
    "n/a",
    "none",
    "null",
    "i'm looking for a job",
    "i am looking for a job",
    "ابحث عن عمل",
    "انا ابحث عن عمل",
    "لايوجد",
    "لا يوجد",
  ].includes(normalized);
}

function safeConfidence(raw: string, fallback = "unknown") {
  const normalized = String(raw || "").trim().toLowerCase();
  return ["high", "medium", "low", "unknown"].includes(normalized) ? normalized : fallback;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEligibleCompanies() {
  const [missingSearchStatus, nonFinalSearchStatus] = await Promise.all([
    searchAll(
      "companies",
      COMPANY_PROPERTIES,
      [{ propertyName: "search_status", operator: "NOT_HAS_PROPERTY" }],
      ["hs_object_id"],
    ),
    searchAll(
      "companies",
      COMPANY_PROPERTIES,
      [
        { propertyName: "search_status", operator: "NEQ", value: "Completed" },
        { propertyName: "search_status", operator: "NEQ", value: "Needs Review" },
      ],
      ["hs_object_id"],
    ),
  ]);

  const merged = new Map<string, HubSpotRecord>();
  for (const record of [...missingSearchStatus, ...nonFinalSearchStatus]) {
    if (!isFinalSearchStatus(value(record, "search_status"))) merged.set(String(record.id), record);
  }

  return [...merged.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

async function readCurrentCompany(companyId: string) {
  return (await batchRead("companies", [companyId], COMPANY_PROPERTIES))[0] || null;
}

async function callCareerEngine(record: HubSpotRecord, forceRefresh: boolean) {
  const companyName = value(record, "name") || "Unnamed company";
  const careerPageUrl = value(record, "career_page_url");
  const domain = normalizeDomain(value(record, "domain") || value(record, "company_website") || value(record, "website") || careerPageUrl);
  const website = normalizeWebsite(value(record, "company_website") || value(record, "website"), domain, careerPageUrl);

  if (!domain && !website) {
    return {
      result: {
        career_status: isPlaceholderCompany(companyName) ? "insufficient_company_data" : "needs_manual_review",
        career_url: careerPageUrl,
        career_confidence_score: isPlaceholderCompany(companyName) ? 99 : 35,
        ats_status: "unclear",
        detected_ats: "",
        ats_confidence: "unknown",
        ats_evidence_url: careerPageUrl,
        ats_evidence_reason: "No usable company website, domain, or Career Page URL is available for automated verification.",
        detection_method: "input_missing_website",
        pages_checked: 0,
        browser_pages_checked: 0,
        playwright_used: false,
      } satisfies EngineResult,
      durationMs: 0,
    };
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(ENGINE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          company_domain: domain,
          company_website: website,
          known_career_url: careerPageUrl || undefined,
          detect_ats: true,
          career_only: false,
          stop_on_career: false,
          require_job_detail: false,
          force_browser: true,
          force_refresh: forceRefresh,
          max_static_pages: 36,
          max_browser_steps: 12,
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as EngineResponse;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `Career engine HTTP ${response.status}`);
      return { result: payload.result || {}, durationMs: Number(payload.duration_ms || (Date.now() - started)) };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await delay(750);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Career engine request failed");
}

function deriveDecision(record: HubSpotRecord, engine: EngineResult) {
  const existingCareer = value(record, "career_page_url");
  const existingAtsRaw = value(record, "detected_ats");
  const existingAts = normalizeAts(existingAtsRaw);
  const existingAtsValid = !isWeakAts(existingAts);
  const existingAtsStrong = existingAtsValid
    && value(record, "ats_status").toLowerCase() === "detected"
    && value(record, "ats_confidence").toLowerCase() === "high"
    && Boolean(value(record, "ats_evidence_url"));

  const engineCareer = String(engine.career_url || "").trim();
  const careerStatus = String(engine.career_status || "").trim().toLowerCase();
  const careerScore = Math.max(0, Math.min(100, Number(engine.career_confidence_score || 0)));
  const engineAts = normalizeAts(String(engine.detected_ats || ""));
  const engineAtsStatus = String(engine.ats_status || "").trim().toLowerCase();
  const engineAtsConfidence = safeConfidence(String(engine.ats_confidence || ""));
  const engineAtsDetected = engineAtsStatus === "detected" && !isWeakAts(engineAts);
  const pagesChecked = Number(engine.pages_checked || 0);
  const browserPagesChecked = Number(engine.browser_pages_checked || 0);
  const detectionError = String(engine.detection_error || "").trim();
  const evidenceUrl = String(engine.ats_evidence_url || engine.career_evidence_url || engineCareer || existingCareer || "").trim();
  const evidenceReason = String(engine.ats_evidence_reason || engine.career_evidence_reason || detectionError || "Career + ATS verification completed.").trim();

  const engineConflict = existingAtsValid && engineAtsDetected && !sameAts(existingAts, engineAts);
  if (engineConflict) {
    return {
      searchStatus: "Needs Review" as const,
      decision: "ats_vendor_conflict",
      careerPageUrl: existingCareer || engineCareer,
      detectedAts: existingAts,
      atsStatus: value(record, "ats_status") || "detected",
      atsConfidence: safeConfidence(value(record, "ats_confidence")),
      evidenceUrl: value(record, "ats_evidence_url") || evidenceUrl,
      reason: `Existing ATS (${existingAts}) conflicts with fresh crawler evidence (${engineAts}). ${evidenceReason}`.slice(0, 1000),
    };
  }

  if (["needs_manual_review", "website_domain_invalid", "insufficient_company_data"].includes(careerStatus)) {
    return {
      searchStatus: "Needs Review" as const,
      decision: careerStatus || "manual_review",
      careerPageUrl: existingCareer || engineCareer,
      detectedAts: existingAtsValid ? existingAts : "",
      atsStatus: existingAtsValid ? "detected" : "unclear",
      atsConfidence: existingAtsValid ? safeConfidence(value(record, "ats_confidence")) : "unknown",
      evidenceUrl: value(record, "ats_evidence_url") || evidenceUrl,
      reason: evidenceReason.slice(0, 1000),
    };
  }

  if (careerStatus === "no_public_career_page") {
    if (existingAtsValid) {
      return {
        searchStatus: "Needs Review" as const,
        decision: "ats_exists_but_career_not_verified",
        careerPageUrl: existingCareer,
        detectedAts: existingAts,
        atsStatus: value(record, "ats_status") || "detected",
        atsConfidence: safeConfidence(value(record, "ats_confidence")),
        evidenceUrl: value(record, "ats_evidence_url") || evidenceUrl,
        reason: `A prior ATS value exists, but the fresh crawl could not verify a public Career Page. ${evidenceReason}`.slice(0, 1000),
      };
    }
    if (careerScore >= 88 && pagesChecked > 0 && !detectionError) {
      return {
        searchStatus: "Completed" as const,
        decision: "no_public_career_page_verified",
        careerPageUrl: "",
        detectedAts: "No Visible ATS",
        atsStatus: "not_detected",
        atsConfidence: browserPagesChecked > 0 ? "high" : "medium",
        evidenceUrl,
        reason: evidenceReason.slice(0, 1000),
      };
    }
  }

  if (careerStatus === "found_verified" && (existingCareer || engineCareer) && careerScore >= 90) {
    if (engineAtsDetected) {
      if (engineAtsConfidence === "high" || engineAtsConfidence === "medium") {
        return {
          searchStatus: "Completed" as const,
          decision: existingAtsValid ? "ats_reverified" : "ats_detected",
          careerPageUrl: existingCareer || engineCareer,
          detectedAts: existingAtsValid ? existingAts : engineAts,
          atsStatus: "detected",
          atsConfidence: existingAtsValid && sameAts(existingAts, engineAts)
            ? safeConfidence(value(record, "ats_confidence"), engineAtsConfidence)
            : engineAtsConfidence,
          evidenceUrl: existingAtsStrong ? value(record, "ats_evidence_url") : evidenceUrl,
          reason: existingAtsStrong ? value(record, "ats_evidence_reason") || evidenceReason : evidenceReason.slice(0, 1000),
        };
      }
    }

    if (engineAtsStatus === "not_detected" && pagesChecked > 0 && !detectionError) {
      if (existingAtsValid) {
        return {
          searchStatus: "Needs Review" as const,
          decision: "existing_ats_not_reproduced",
          careerPageUrl: existingCareer || engineCareer,
          detectedAts: existingAts,
          atsStatus: value(record, "ats_status") || "detected",
          atsConfidence: safeConfidence(value(record, "ats_confidence")),
          evidenceUrl: value(record, "ats_evidence_url") || evidenceUrl,
          reason: `A prior ATS vendor (${existingAts}) could not be reproduced by the fresh full career journey. ${evidenceReason}`.slice(0, 1000),
        };
      }
      return {
        searchStatus: "Completed" as const,
        decision: "no_visible_ats_verified",
        careerPageUrl: existingCareer || engineCareer,
        detectedAts: "No Visible ATS",
        atsStatus: "not_detected",
        atsConfidence: engineAtsConfidence === "unknown" ? (browserPagesChecked > 0 ? "high" : "medium") : engineAtsConfidence,
        evidenceUrl,
        reason: evidenceReason.slice(0, 1000),
      };
    }

    if (existingAtsStrong && !engineAtsDetected && !detectionError) {
      return {
        searchStatus: "Completed" as const,
        decision: "existing_high_confidence_ats_preserved",
        careerPageUrl: existingCareer || engineCareer,
        detectedAts: existingAts,
        atsStatus: "detected",
        atsConfidence: "high",
        evidenceUrl: value(record, "ats_evidence_url"),
        reason: value(record, "ats_evidence_reason") || evidenceReason.slice(0, 1000),
      };
    }
  }

  return {
    searchStatus: "Needs Review" as const,
    decision: "inconclusive_after_full_scan",
    careerPageUrl: existingCareer || engineCareer,
    detectedAts: existingAtsValid ? existingAts : "",
    atsStatus: existingAtsValid ? "detected" : (engineAtsStatus === "not_checked" ? "unclear" : engineAtsStatus || "unclear"),
    atsConfidence: existingAtsValid ? safeConfidence(value(record, "ats_confidence")) : engineAtsConfidence,
    evidenceUrl: value(record, "ats_evidence_url") || evidenceUrl,
    reason: evidenceReason.slice(0, 1000),
  };
}

function buildHubSpotProperties(record: HubSpotRecord, decision: ReturnType<typeof deriveDecision>) {
  const properties: Record<string, string> = { search_status: decision.searchStatus };
  const existingCareer = value(record, "career_page_url");
  const existingAts = value(record, "detected_ats");
  const existingAtsWeak = isWeakAts(existingAts);
  const existingPortalType = value(record, "career_portal_type");

  if (!existingCareer && decision.careerPageUrl) properties.career_page_url = decision.careerPageUrl;

  if ((existingAtsWeak || !existingAts) && decision.detectedAts) properties.detected_ats = decision.detectedAts;
  if ((existingAtsWeak || !existingAts || !value(record, "ats_status")) && decision.atsStatus) properties.ats_status = decision.atsStatus;
  if ((existingAtsWeak || !value(record, "ats_confidence")) && decision.atsConfidence) properties.ats_confidence = safeConfidence(decision.atsConfidence);
  if ((existingAtsWeak || !value(record, "ats_evidence_url")) && decision.evidenceUrl) properties.ats_evidence_url = decision.evidenceUrl;
  if ((existingAtsWeak || !value(record, "ats_evidence_reason")) && decision.reason) properties.ats_evidence_reason = decision.reason.slice(0, 1000);
  if ((!existingPortalType || existingPortalType === "unknown") && decision.atsStatus === "detected" && !isWeakAts(decision.detectedAts)) {
    properties.career_portal_type = "vendor_hosted_portal";
  }

  return properties;
}

async function patchHubSpotCompany(companyId: string, properties: Record<string, string>) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured");

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(companyId)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties }),
        cache: "no-store",
      });
      if (response.ok) return;
      const body = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        await delay(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      throw new Error(`HubSpot update failed (${response.status}): ${body.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("HubSpot update failed");
}

async function patchAndVerify(companyId: string, properties: Record<string, string>) {
  await patchHubSpotCompany(companyId, properties);
  const verify = await readCurrentCompany(companyId);
  if (!verify) throw new Error("HubSpot read-back failed after update");

  const mismatches = Object.entries(properties).filter(([key, expected]) => value(verify, key) !== expected);
  if (mismatches.length) {
    throw new Error(`HubSpot read-back mismatch: ${mismatches.map(([key, expected]) => `${key}=${JSON.stringify(expected)}`).join(", ")}`);
  }
  return verify;
}

async function processCompany(seed: HubSpotRecord, forceRefresh: boolean): Promise<CareerAtsBackfillItem> {
  const started = Date.now();
  const companyId = String(seed.id);
  const companyName = value(seed, "name") || "Unnamed company";

  try {
    const current = await readCurrentCompany(companyId);
    if (!current) throw new Error("HubSpot company could not be re-read");
    const previousSearchStatus = value(current, "search_status");
    if (isFinalSearchStatus(previousSearchStatus)) {
      return {
        companyId,
        companyName: value(current, "name") || companyName,
        previousSearchStatus,
        searchStatus: "Skipped",
        careerPageUrl: value(current, "career_page_url"),
        detectedAts: value(current, "detected_ats"),
        atsStatus: value(current, "ats_status"),
        atsConfidence: value(current, "ats_confidence"),
        evidenceUrl: value(current, "ats_evidence_url"),
        reason: "Skipped because another worker already finalized Search Status.",
        decision: "already_finalized",
        pagesChecked: 0,
        browserPagesChecked: 0,
        playwrightUsed: false,
        hubspotVerified: true,
        durationMs: Date.now() - started,
      };
    }

    const engineCall = await callCareerEngine(current, forceRefresh);
    const decision = deriveDecision(current, engineCall.result);
    const properties = buildHubSpotProperties(current, decision);
    const verified = await patchAndVerify(companyId, properties);

    return {
      companyId,
      companyName: value(verified, "name") || companyName,
      previousSearchStatus,
      searchStatus: decision.searchStatus,
      careerPageUrl: value(verified, "career_page_url"),
      detectedAts: value(verified, "detected_ats"),
      atsStatus: value(verified, "ats_status"),
      atsConfidence: value(verified, "ats_confidence"),
      evidenceUrl: value(verified, "ats_evidence_url"),
      reason: decision.reason,
      decision: decision.decision,
      pagesChecked: Number(engineCall.result.pages_checked || 0),
      browserPagesChecked: Number(engineCall.result.browser_pages_checked || 0),
      playwrightUsed: Boolean(engineCall.result.playwright_used),
      hubspotVerified: true,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      companyId,
      companyName,
      previousSearchStatus: value(seed, "search_status"),
      searchStatus: "Error",
      careerPageUrl: value(seed, "career_page_url"),
      detectedAts: value(seed, "detected_ats"),
      atsStatus: value(seed, "ats_status"),
      atsConfidence: value(seed, "ats_confidence"),
      evidenceUrl: value(seed, "ats_evidence_url"),
      reason: error instanceof Error ? error.message : "Unknown Career + ATS backfill error",
      decision: "processing_error",
      pagesChecked: 0,
      browserPagesChecked: 0,
      playwrightUsed: false,
      hubspotVerified: false,
      durationMs: Date.now() - started,
    };
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, action: (item: T) => Promise<R>) {
  if (!items.length) return [] as R[];
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await action(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

export async function getCareerAtsBackfillStatus() {
  const eligible = await loadEligibleCompanies();
  return {
    remainingEligible: eligible.length,
    nextCompanyId: eligible[0] ? String(eligible[0].id) : "",
    nextCompanyName: eligible[0] ? value(eligible[0], "name") : "",
    batchLimit: DEFAULT_BATCH_LIMIT,
    concurrency: CONCURRENCY,
  };
}

export async function runCareerAtsBackfillBatch(input: { limit?: number; forceRefresh?: boolean } = {}) {
  const eligible = await loadEligibleCompanies();
  const limit = Math.max(1, Math.min(100, Number(input.limit || DEFAULT_BATCH_LIMIT)));
  const selected = eligible.slice(0, limit);
  const processed = await mapConcurrent(selected, CONCURRENCY, (record) => processCompany(record, input.forceRefresh !== false));
  const remaining = await loadEligibleCompanies();

  const summary: CareerAtsBackfillSummary = {
    eligibleBefore: eligible.length,
    selected: selected.length,
    processed: processed.length,
    completed: processed.filter((item) => item.searchStatus === "Completed").length,
    needsReview: processed.filter((item) => item.searchStatus === "Needs Review").length,
    skipped: processed.filter((item) => item.searchStatus === "Skipped").length,
    errors: processed.filter((item) => item.searchStatus === "Error").length,
    hubspotVerified: processed.filter((item) => item.hubspotVerified).length,
    remainingEligible: remaining.length,
  };

  return { summary, processed };
}
