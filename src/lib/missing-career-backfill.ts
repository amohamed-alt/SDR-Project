import { batchRead, searchAll } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

const ENGINE_URL = process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/intelligence-detect";
const ENGINE_TIMEOUT_MS = Math.max(30_000, Number(process.env.CAREER_ENGINE_TIMEOUT_MS || 180_000));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CAREER_SCAN_CONCURRENCY || 6)));
const FINAL_STATUSES = new Set(["completed", "needs review"]);

const PROPERTIES = [
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

type EngineResult = {
  career_status?: string;
  career_url?: string;
  career_confidence_score?: number;
  career_evidence_url?: string;
  career_evidence_reason?: string;
  ats_status?: string;
  detected_ats?: string;
  ats_confidence?: string;
  ats_evidence_url?: string;
  ats_evidence_reason?: string;
  pages_checked?: number;
  browser_pages_checked?: number;
  playwright_used?: boolean;
  detection_error?: string;
};

type EngineResponse = { ok?: boolean; result?: EngineResult; duration_ms?: number; error?: string };

export type MissingCareerBackfillItem = {
  companyId: string;
  companyName: string;
  outcome: "Completed" | "Needs Review" | "Skipped" | "Error";
  careerPageUrl: string;
  detectedAts: string;
  atsStatus: string;
  atsConfidence: string;
  evidenceUrl: string;
  reason: string;
  pagesChecked: number;
  browserPagesChecked: number;
  durationMs: number;
};

function prop(record: HubSpotRecord, name: string) {
  return String(record.properties[name] || "").trim();
}

function isFinal(value: string) {
  return FINAL_STATUSES.has(String(value || "").trim().toLowerCase());
}

function normalizeAts(raw: string) {
  const value = String(raw || "").trim();
  const lower = value.toLowerCase();
  if (!value) return "";
  if (lower === "hyrdd" || lower.includes("kabi hyrdd") || lower.includes("hyrdd by kabi")) return "KABi";
  if (["oracle recruiting", "oracle recruiting cloud", "oracle hcm", "oracle hcm cloud"].includes(lower)) return "Oracle HCM Cloud";
  if (lower === "taleo") return "Oracle Taleo";
  if (lower === "adrenalin max") return "Adrenalin";
  return value;
}

function weakAts(raw: string) {
  const value = normalizeAts(raw).toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return !value || [
    "unknown",
    "unclear",
    "custom",
    "not detected",
    "no visible ats",
    "no ats",
    "none",
    "n/a",
    "na",
  ].includes(value);
}

function normalizeDomain(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return input.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

function normalizeWebsite(raw: string, domain: string) {
  const input = String(raw || "").trim();
  if (input) return /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return domain ? `https://${domain}` : "";
}

function safeConfidence(raw: string, fallback = "unknown") {
  const value = String(raw || "").trim().toLowerCase();
  return ["high", "medium", "low", "unknown"].includes(value) ? value : fallback;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadMissingCareerQueue() {
  const [missingStatus, activeStatus] = await Promise.all([
    searchAll(
      "companies",
      PROPERTIES,
      [
        { propertyName: "career_page_url", operator: "NOT_HAS_PROPERTY" },
        { propertyName: "search_status", operator: "NOT_HAS_PROPERTY" },
      ],
      ["hs_object_id"],
    ),
    searchAll(
      "companies",
      PROPERTIES,
      [
        { propertyName: "career_page_url", operator: "NOT_HAS_PROPERTY" },
        { propertyName: "search_status", operator: "NEQ", value: "Completed" },
        { propertyName: "search_status", operator: "NEQ", value: "Needs Review" },
      ],
      ["hs_object_id"],
    ),
  ]);

  const merged = new Map<string, HubSpotRecord>();
  for (const record of [...missingStatus, ...activeStatus]) {
    if (!prop(record, "career_page_url") && !isFinal(prop(record, "search_status"))) {
      merged.set(String(record.id), record);
    }
  }
  return [...merged.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

async function readCompany(id: string) {
  return (await batchRead("companies", [id], PROPERTIES))[0] || null;
}

async function callEngine(record: HubSpotRecord) {
  const domain = normalizeDomain(prop(record, "domain") || prop(record, "company_website") || prop(record, "website"));
  const website = normalizeWebsite(prop(record, "company_website") || prop(record, "website"), domain);
  if (!website && !domain) {
    return {
      result: {
        career_status: "needs_manual_review",
        ats_status: "unclear",
        ats_confidence: "unknown",
        ats_evidence_reason: "No usable website or domain is available for Career Page discovery.",
        pages_checked: 0,
        browser_pages_checked: 0,
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
          company_name: prop(record, "name") || "Unnamed company",
          company_domain: domain,
          company_website: website,
          detect_ats: true,
          career_only: false,
          stop_on_career: false,
          require_job_detail: false,
          force_browser: true,
          force_refresh: true,
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
      if (attempt === 0) await sleep(750);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Career engine request failed");
}

function decide(record: HubSpotRecord, engine: EngineResult) {
  const careerStatus = String(engine.career_status || "").trim().toLowerCase();
  const careerUrl = String(engine.career_url || "").trim();
  const careerScore = Number(engine.career_confidence_score || 0);
  const pages = Number(engine.pages_checked || 0);
  const browserPages = Number(engine.browser_pages_checked || 0);
  const detectionError = String(engine.detection_error || "").trim();

  const currentAts = normalizeAts(prop(record, "detected_ats"));
  const currentAtsValid = !weakAts(currentAts);
  const engineAts = normalizeAts(String(engine.detected_ats || ""));
  const engineAtsStatus = String(engine.ats_status || "").trim().toLowerCase();
  const engineAtsValid = engineAtsStatus === "detected" && !weakAts(engineAts);
  const engineConfidence = safeConfidence(String(engine.ats_confidence || ""));
  const evidenceUrl = String(engine.ats_evidence_url || engine.career_evidence_url || careerUrl || "").trim();
  const evidenceReason = String(
    engine.ats_evidence_reason
      || engine.career_evidence_reason
      || detectionError
      || "Career Page and ATS discovery completed.",
  ).trim().slice(0, 1000);

  if (currentAtsValid && engineAtsValid && currentAts.toLowerCase() !== engineAts.toLowerCase()) {
    return {
      searchStatus: "Needs Review" as const,
      careerUrl,
      detectedAts: currentAts,
      atsStatus: prop(record, "ats_status") || "detected",
      atsConfidence: safeConfidence(prop(record, "ats_confidence")),
      evidenceUrl: prop(record, "ats_evidence_url") || evidenceUrl,
      reason: `Existing ATS (${currentAts}) conflicts with fresh ATS evidence (${engineAts}). ${evidenceReason}`.slice(0, 1000),
      portalType: prop(record, "career_portal_type"),
    };
  }

  if (careerStatus === "found_verified" && careerUrl && careerScore >= 88) {
    if (engineAtsValid) {
      return {
        searchStatus: "Completed" as const,
        careerUrl,
        detectedAts: currentAtsValid ? currentAts : engineAts,
        atsStatus: "detected",
        atsConfidence: currentAtsValid ? safeConfidence(prop(record, "ats_confidence"), engineConfidence) : engineConfidence,
        evidenceUrl: currentAtsValid && prop(record, "ats_evidence_url") ? prop(record, "ats_evidence_url") : evidenceUrl,
        reason: currentAtsValid && prop(record, "ats_evidence_reason") ? prop(record, "ats_evidence_reason") : evidenceReason,
        portalType: "vendor_hosted_portal",
      };
    }

    if (currentAtsValid) {
      return {
        searchStatus: "Completed" as const,
        careerUrl,
        detectedAts: currentAts,
        atsStatus: prop(record, "ats_status") || "detected",
        atsConfidence: safeConfidence(prop(record, "ats_confidence")),
        evidenceUrl: prop(record, "ats_evidence_url") || evidenceUrl,
        reason: prop(record, "ats_evidence_reason") || evidenceReason,
        portalType: prop(record, "career_portal_type") || "vendor_hosted_portal",
      };
    }

    if (["not_detected", "unclear"].includes(engineAtsStatus) && pages > 0 && !detectionError) {
      return {
        searchStatus: "Completed" as const,
        careerUrl,
        detectedAts: "No Visible ATS",
        atsStatus: "not_detected",
        atsConfidence: browserPages > 0 ? "high" : "medium",
        evidenceUrl,
        reason: evidenceReason || "Verified Career Page; no externally visible ATS vendor was identified after the full career journey.",
        portalType: "basic_jobs_page",
      };
    }
  }

  if (careerStatus === "no_public_career_page" && careerScore >= 88 && pages > 0 && !detectionError) {
    return {
      searchStatus: "Completed" as const,
      careerUrl: "",
      detectedAts: currentAtsValid ? currentAts : "No Visible ATS",
      atsStatus: currentAtsValid ? (prop(record, "ats_status") || "detected") : "not_detected",
      atsConfidence: currentAtsValid ? safeConfidence(prop(record, "ats_confidence")) : (browserPages > 0 ? "high" : "medium"),
      evidenceUrl: prop(record, "ats_evidence_url") || evidenceUrl,
      reason: evidenceReason || "No public Career Page was verified after the full official-site discovery journey.",
      portalType: prop(record, "career_portal_type") || "unknown",
    };
  }

  return {
    searchStatus: "Needs Review" as const,
    careerUrl,
    detectedAts: currentAtsValid ? currentAts : (engineAtsValid ? engineAts : ""),
    atsStatus: currentAtsValid || engineAtsValid ? "detected" : "unclear",
    atsConfidence: currentAtsValid ? safeConfidence(prop(record, "ats_confidence")) : engineConfidence,
    evidenceUrl: prop(record, "ats_evidence_url") || evidenceUrl,
    reason: evidenceReason,
    portalType: prop(record, "career_portal_type") || "unknown",
  };
}

async function patchCompany(id: string, properties: Record<string, string>) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured");

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties }),
        cache: "no-store",
      });
      if (response.ok) return;
      const body = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      throw new Error(`HubSpot update failed (${response.status}): ${body.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("HubSpot update failed");
}

async function processOne(seed: HubSpotRecord): Promise<MissingCareerBackfillItem> {
  const started = Date.now();
  const companyId = String(seed.id);
  const companyName = prop(seed, "name") || "Unnamed company";
  try {
    const current = await readCompany(companyId);
    if (!current) throw new Error("Company could not be re-read from HubSpot");
    if (prop(current, "career_page_url") || isFinal(prop(current, "search_status"))) {
      return {
        companyId,
        companyName: prop(current, "name") || companyName,
        outcome: "Skipped",
        careerPageUrl: prop(current, "career_page_url"),
        detectedAts: prop(current, "detected_ats"),
        atsStatus: prop(current, "ats_status"),
        atsConfidence: prop(current, "ats_confidence"),
        evidenceUrl: prop(current, "ats_evidence_url"),
        reason: "Skipped because another worker already supplied Career Page or finalized Search Status.",
        pagesChecked: 0,
        browserPagesChecked: 0,
        durationMs: Date.now() - started,
      };
    }

    const engineCall = await callEngine(current);
    const decision = decide(current, engineCall.result);
    const properties: Record<string, string> = { search_status: decision.searchStatus };

    if (decision.careerUrl) properties.career_page_url = decision.careerUrl;
    if ((!prop(current, "detected_ats") || weakAts(prop(current, "detected_ats"))) && decision.detectedAts) properties.detected_ats = decision.detectedAts;
    if (!prop(current, "ats_status") || weakAts(prop(current, "detected_ats"))) properties.ats_status = decision.atsStatus;
    if (!prop(current, "ats_confidence") || weakAts(prop(current, "detected_ats"))) properties.ats_confidence = safeConfidence(decision.atsConfidence);
    if (!prop(current, "ats_evidence_url") && decision.evidenceUrl) properties.ats_evidence_url = decision.evidenceUrl;
    if ((!prop(current, "ats_evidence_reason") || weakAts(prop(current, "detected_ats"))) && decision.reason) properties.ats_evidence_reason = decision.reason.slice(0, 1000);
    if ((!prop(current, "career_portal_type") || prop(current, "career_portal_type") === "unknown") && decision.portalType) properties.career_portal_type = decision.portalType;

    await patchCompany(companyId, properties);
    const verified = await readCompany(companyId);
    if (!verified) throw new Error("HubSpot read-back failed");
    for (const [key, expected] of Object.entries(properties)) {
      if (prop(verified, key) !== expected) throw new Error(`HubSpot read-back mismatch for ${key}`);
    }

    return {
      companyId,
      companyName: prop(verified, "name") || companyName,
      outcome: decision.searchStatus,
      careerPageUrl: prop(verified, "career_page_url"),
      detectedAts: prop(verified, "detected_ats"),
      atsStatus: prop(verified, "ats_status"),
      atsConfidence: prop(verified, "ats_confidence"),
      evidenceUrl: prop(verified, "ats_evidence_url"),
      reason: decision.reason,
      pagesChecked: Number(engineCall.result.pages_checked || 0),
      browserPagesChecked: Number(engineCall.result.browser_pages_checked || 0),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      companyId,
      companyName,
      outcome: "Error",
      careerPageUrl: prop(seed, "career_page_url"),
      detectedAts: prop(seed, "detected_ats"),
      atsStatus: prop(seed, "ats_status"),
      atsConfidence: prop(seed, "ats_confidence"),
      evidenceUrl: prop(seed, "ats_evidence_url"),
      reason: error instanceof Error ? error.message : "Unknown missing Career Page backfill error",
      pagesChecked: 0,
      browserPagesChecked: 0,
      durationMs: Date.now() - started,
    };
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, action: (item: T) => Promise<R>) {
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

export async function getMissingCareerBackfillStatus() {
  const queue = await loadMissingCareerQueue();
  return {
    remainingMissingCareer: queue.length,
    nextCompanyId: queue[0] ? String(queue[0].id) : "",
    nextCompanyName: queue[0] ? prop(queue[0], "name") : "",
    concurrency: CONCURRENCY,
  };
}

export async function runMissingCareerBackfillBatch(input: { limit?: number } = {}) {
  const before = await loadMissingCareerQueue();
  const limit = Math.max(1, Math.min(100, Number(input.limit || 50)));
  const selected = before.slice(0, limit);
  const processed = await mapConcurrent(selected, CONCURRENCY, processOne);
  const after = await loadMissingCareerQueue();
  return {
    summary: {
      eligibleBefore: before.length,
      selected: selected.length,
      processed: processed.length,
      completed: processed.filter((item) => item.outcome === "Completed").length,
      needsReview: processed.filter((item) => item.outcome === "Needs Review").length,
      skipped: processed.filter((item) => item.outcome === "Skipped").length,
      errors: processed.filter((item) => item.outcome === "Error").length,
      careerPagesAdded: processed.filter((item) => Boolean(item.careerPageUrl) && item.outcome !== "Skipped" && item.outcome !== "Error").length,
      atsDetected: processed.filter((item) => item.atsStatus === "detected" && !weakAts(item.detectedAts)).length,
      noVisibleAts: processed.filter((item) => item.detectedAts === "No Visible ATS").length,
      remainingMissingCareer: after.length,
    },
    processed,
  };
}
