import fs from "node:fs/promises";
import path from "node:path";
import { batchRead, searchAll } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

export type CareerStatus =
  | "needs_research"
  | "processing"
  | "found_verified"
  | "no_public_career_page"
  | "needs_manual_review"
  | "website_domain_invalid"
  | "insufficient_company_data";

export interface CareerCompany {
  companyId: string;
  companyName: string;
  domain: string;
  website: string;
  careerPageUrl: string;
  detectedAts: string;
  atsStatus: string;
  atsConfidence: string;
  status: CareerStatus;
  confidenceScore: number;
  verificationReason: string;
  verificationSource: string;
  evidenceUrl: string;
  detectionMethod: string;
  pagesChecked: number;
  staticPagesChecked: number;
  browserPagesChecked: number;
  cacheHit: boolean;
  playwrightUsed: boolean;
  lastCheckedAt: string;
  hubspotUrl: string;
  hubspotPushStatus: "" | "pushed" | "skipped" | "error";
  hubspotPushedAt: string;
  engineDurationMs: number;
}

interface StoredCompany extends CareerCompany {
  updatedAt: string;
}

interface CareerStore {
  version: 1;
  updatedAt: string;
  records: Record<string, StoredCompany>;
}

interface CareerEngineResponse {
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
    pages_checked?: number;
    static_pages_checked?: number;
    browser_pages_checked?: number;
    cache_hit?: boolean;
    playwright_used?: boolean;
    detection_error?: string;
  };
  error?: string;
}

export interface CareerSummary {
  total: number;
  completed: number;
  remaining: number;
  foundVerified: number;
  noPublicCareer: number;
  manualReview: number;
  invalidDomain: number;
  insufficientData: number;
  processing: number;
  staticResolved: number;
  browserResolved: number;
  cacheResolved: number;
  coverageRate: number;
  browserUsageRate: number;
}

const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "company_website",
  "career_page_url",
  "career_portal_type",
  "detected_ats",
  "ats_status",
  "ats_confidence",
  "ats_evidence_url",
  "ats_evidence_reason",
] as const;

const STORE_PATH = process.env.CAREER_INTELLIGENCE_STORE_PATH || "/app/data/career-intelligence.json";
const ENGINE_URL = process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/intelligence-detect";
const ENGINE_TIMEOUT_MS = Math.max(10_000, Number(process.env.CAREER_ENGINE_TIMEOUT_MS || 180_000));
const DEFAULT_SCAN_LIMIT = Math.max(1, Math.min(100, Number(process.env.CAREER_SCAN_LIMIT || 30)));
const SCAN_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.CAREER_SCAN_CONCURRENCY || 6)));
const PORTFOLIO_CACHE_MS = Math.max(10_000, Number(process.env.CAREER_PORTFOLIO_CACHE_MS || 60_000));
const AUTO_PUSH = String(process.env.CAREER_AUTO_PUSH || "false").toLowerCase() === "true";

let storeQueue: Promise<void> = Promise.resolve();
let portfolioCache: { expiresAt: number; companies: CareerCompany[] } | null = null;

function value(record: HubSpotRecord, property: string) {
  return String(record.properties[property] || "").trim();
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

function isPlaceholderCompany(name: string) {
  const normalized = name.trim().toLowerCase();
  return !normalized || ["-", "(no value)", "no", "na", "n/a", "none", "null", "i'm looking for a job", "i am looking for a job", "انا ابحث عن عمل", "لايوجد", "لا يوجد"].includes(normalized);
}

function hubspotCompanyUrl(companyId: string) {
  const portalId = process.env.HUBSPOT_PORTAL_ID || "145742477";
  const host = process.env.HUBSPOT_UI_DOMAIN || "app-eu1.hubspot.com";
  return `https://${host}/contacts/${portalId}/company/${companyId}`;
}

function blankCompany(record: HubSpotRecord): CareerCompany {
  const companyName = value(record, "name") || "Unnamed company";
  const domain = normalizeDomain(value(record, "domain") || value(record, "company_website"));
  const website = normalizeWebsite(value(record, "company_website"), domain);
  const careerPageUrl = value(record, "career_page_url");
  const detectedAts = value(record, "detected_ats");
  const atsStatus = value(record, "ats_status");
  let status: CareerStatus = "needs_research";
  let reason = careerPageUrl && !detectedAts
    ? "Career Page already exists in HubSpot; ATS fingerprinting is pending."
    : "Waiting for Career + ATS Intelligence scan.";

  if (!domain && isPlaceholderCompany(companyName)) {
    status = "insufficient_company_data";
    reason = "No usable domain and the company identity is blank or a placeholder.";
  } else if (!domain) {
    status = "needs_manual_review";
    reason = "Company has no usable domain; identity resolution is required before crawling.";
  } else if (careerPageUrl && detectedAts) {
    status = "found_verified";
    reason = "Career Page and ATS already exist in HubSpot.";
  }

  return {
    companyId: String(record.id),
    companyName,
    domain,
    website,
    careerPageUrl,
    detectedAts,
    atsStatus,
    atsConfidence: value(record, "ats_confidence"),
    status,
    confidenceScore: status === "insufficient_company_data" ? 99 : status === "needs_manual_review" ? 40 : status === "found_verified" ? 99 : 0,
    verificationReason: reason,
    verificationSource: "HubSpot",
    evidenceUrl: value(record, "ats_evidence_url"),
    detectionMethod: "",
    pagesChecked: 0,
    staticPagesChecked: 0,
    browserPagesChecked: 0,
    cacheHit: false,
    playwrightUsed: false,
    lastCheckedAt: "",
    hubspotUrl: hubspotCompanyUrl(String(record.id)),
    hubspotPushStatus: "",
    hubspotPushedAt: "",
    engineDurationMs: 0,
  };
}

function demoCompanies(): CareerCompany[] {
  const records = [
    { id: "demo-1", name: "YMCO", domain: "ymco.sa", status: "found_verified" as CareerStatus, career: "https://ymco.sa/?page_id=5534", ats: "Workday" },
    { id: "demo-2", name: "Example Gulf Holdings", domain: "example-gulf.com", status: "needs_research" as CareerStatus, career: "", ats: "" },
    { id: "demo-3", name: "Existing Career ATS Pending", domain: "example.sa", status: "needs_research" as CareerStatus, career: "https://example.sa/careers", ats: "" },
    { id: "demo-4", name: "Blocked Example", domain: "blocked.example", status: "website_domain_invalid" as CareerStatus, career: "", ats: "" },
  ];
  return records.map((item) => ({
    companyId: item.id,
    companyName: item.name,
    domain: item.domain,
    website: `https://${item.domain}`,
    careerPageUrl: item.career,
    detectedAts: item.ats,
    atsStatus: item.ats ? "detected" : "",
    atsConfidence: item.ats ? "high" : "",
    status: item.status,
    confidenceScore: item.status === "found_verified" ? 96 : item.status === "website_domain_invalid" ? 98 : 45,
    verificationReason: item.status === "found_verified" ? "Verified employer career page and ATS." : "Demo record for dashboard validation.",
    verificationSource: "Demo",
    evidenceUrl: item.career,
    detectionMethod: item.status === "found_verified" ? "static_career_ats_verified" : "",
    pagesChecked: item.status === "found_verified" ? 4 : 0,
    staticPagesChecked: item.status === "found_verified" ? 4 : 0,
    browserPagesChecked: 0,
    cacheHit: false,
    playwrightUsed: false,
    lastCheckedAt: item.status === "needs_research" ? "" : new Date().toISOString(),
    hubspotUrl: "#",
    hubspotPushStatus: "",
    hubspotPushedAt: "",
    engineDurationMs: 0,
  }));
}

async function loadStore(): Promise<CareerStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as CareerStore;
    if (parsed?.version === 1 && parsed.records && typeof parsed.records === "object") return parsed;
  } catch {
    // First run or an empty volume is expected.
  }
  return { version: 1, updatedAt: "", records: {} };
}

async function writeStore(store: CareerStore) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const temp = `${STORE_PATH}.tmp`;
  await fs.writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(temp, STORE_PATH);
}

async function saveCompany(company: CareerCompany) {
  storeQueue = storeQueue.then(async () => {
    const store = await loadStore();
    const timestamp = new Date().toISOString();
    store.updatedAt = timestamp;
    store.records[company.companyId] = { ...company, updatedAt: timestamp };
    await writeStore(store);
  });
  await storeQueue;
}

async function loadHubSpotPortfolio(): Promise<CareerCompany[]> {
  if (process.env.DEMO_MODE === "true") return demoCompanies();

  // HubSpot filter groups are ANDed inside searchAll, so run two bounded searches
  // and merge them to get: Career Page missing OR ATS missing.
  const [missingCareer, missingAts] = await Promise.all([
    searchAll(
      "companies",
      COMPANY_PROPERTIES,
      [{ propertyName: "career_page_url", operator: "NOT_HAS_PROPERTY" }],
      ["hs_object_id"],
    ),
    searchAll(
      "companies",
      COMPANY_PROPERTIES,
      [{ propertyName: "detected_ats", operator: "NOT_HAS_PROPERTY" }],
      ["hs_object_id"],
    ),
  ]);

  const merged = new Map<string, HubSpotRecord>();
  for (const record of [...missingCareer, ...missingAts]) merged.set(String(record.id), record);
  return [...merged.values()].map(blankCompany);
}

function needsEngineScan(company: CareerCompany) {
  if (company.status === "processing" || company.status === "needs_manual_review" || company.status === "website_domain_invalid" || company.status === "insufficient_company_data") return false;
  if (company.status === "needs_research") return true;
  // Upgrade old V2 records that already found a Career Page but stopped before ATS discovery.
  return Boolean(company.careerPageUrl && !company.detectedAts && !company.atsStatus);
}

export async function getCareerPortfolio(force = false): Promise<CareerCompany[]> {
  if (!force && portfolioCache && portfolioCache.expiresAt > Date.now()) return portfolioCache.companies.map((item) => ({ ...item }));
  const [hubspotCompanies, store] = await Promise.all([loadHubSpotPortfolio(), loadStore()]);
  const merged = new Map<string, CareerCompany>();

  for (const company of hubspotCompanies) {
    const stored = store.records[company.companyId];
    const combined = stored
      ? {
          ...company,
          ...stored,
          companyName: company.companyName,
          domain: company.domain || stored.domain,
          website: company.website || stored.website,
          careerPageUrl: company.careerPageUrl || stored.careerPageUrl,
          detectedAts: company.detectedAts || stored.detectedAts,
          atsStatus: company.atsStatus || stored.atsStatus,
          atsConfidence: company.atsConfidence || stored.atsConfidence,
          hubspotUrl: company.hubspotUrl,
        }
      : company;
    merged.set(company.companyId, combined);
  }

  // Keep completed records visible after they have been pushed to HubSpot and therefore
  // no longer match either "missing" search.
  for (const stored of Object.values(store.records)) {
    if (!merged.has(stored.companyId)) merged.set(stored.companyId, { ...stored });
  }

  const companies = [...merged.values()].sort((a, b) => {
    const priority = (company: CareerCompany) => needsEngineScan(company) ? 0 : company.status === "needs_manual_review" ? 1 : company.status === "processing" ? 2 : 3;
    return priority(a) - priority(b) || a.companyName.localeCompare(b.companyName);
  });
  portfolioCache = { expiresAt: Date.now() + PORTFOLIO_CACHE_MS, companies };
  return companies.map((item) => ({ ...item }));
}

export function summarizeCareerPortfolio(companies: CareerCompany[]): CareerSummary {
  const count = (status: CareerStatus) => companies.filter((company) => company.status === status).length;
  const total = companies.length;
  const foundVerified = count("found_verified");
  const noPublicCareer = count("no_public_career_page");
  const invalidDomain = count("website_domain_invalid");
  const insufficientData = count("insufficient_company_data");
  const manualReview = count("needs_manual_review");
  const processing = count("processing");
  const completed = foundVerified + noPublicCareer + invalidDomain + insufficientData;
  const resolved = companies.filter((company) => completedStatus(company.status));
  const staticResolved = resolved.filter((company) => !company.playwrightUsed && !company.cacheHit).length;
  const browserResolved = resolved.filter((company) => company.playwrightUsed).length;
  const cacheResolved = resolved.filter((company) => company.cacheHit).length;
  return {
    total,
    completed,
    remaining: companies.filter(needsEngineScan).length,
    foundVerified,
    noPublicCareer,
    manualReview,
    invalidDomain,
    insufficientData,
    processing,
    staticResolved,
    browserResolved,
    cacheResolved,
    coverageRate: total ? Math.round((completed / total) * 1000) / 10 : 0,
    browserUsageRate: completed ? Math.round((browserResolved / completed) * 1000) / 10 : 0,
  };
}

function completedStatus(status: CareerStatus) {
  return ["found_verified", "no_public_career_page", "website_domain_invalid", "insufficient_company_data"].includes(status);
}

function engineStatus(value: string): CareerStatus {
  const valid: CareerStatus[] = ["found_verified", "no_public_career_page", "needs_manual_review", "website_domain_invalid", "insufficient_company_data"];
  return valid.includes(value as CareerStatus) ? value as CareerStatus : "needs_manual_review";
}

async function callCareerEngine(company: CareerCompany, forceRefresh: boolean): Promise<CareerCompany> {
  if (!company.domain && !company.website) {
    const status: CareerStatus = isPlaceholderCompany(company.companyName) ? "insufficient_company_data" : "needs_manual_review";
    return {
      ...company,
      status,
      confidenceScore: status === "insufficient_company_data" ? 99 : 40,
      verificationReason: status === "insufficient_company_data" ? "No usable company identity or domain." : "No domain is available for automated crawling.",
      verificationSource: "Data validation",
      lastCheckedAt: new Date().toISOString(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: company.companyName,
        company_domain: company.domain,
        company_website: company.website,
        known_career_url: company.careerPageUrl || undefined,
        detect_ats: true,
        career_only: false,
        stop_on_career: false,
        require_job_detail: false,
        force_browser: Boolean(company.careerPageUrl && !company.detectedAts),
        force_refresh: forceRefresh,
        max_static_pages: 36,
        max_browser_steps: 12,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as CareerEngineResponse;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Career engine returned HTTP ${response.status}`);
    const result = payload.result || {};
    let status = engineStatus(String(result.career_status || ""));
    const careerPageUrl = String(result.career_url || company.careerPageUrl || "");
    if (company.careerPageUrl && !result.career_url && status === "no_public_career_page") status = "needs_manual_review";
    const detectedAts = String(result.detected_ats || company.detectedAts || "");
    const atsStatus = String(result.ats_status || company.atsStatus || (careerPageUrl && status === "found_verified" ? "unclear" : ""));
    const detectionMethod = String(result.detection_method || "");
    const cacheHit = Boolean(result.cache_hit) || detectionMethod.startsWith("cache:");
    return {
      ...company,
      careerPageUrl,
      detectedAts,
      atsStatus: detectedAts ? "detected" : atsStatus,
      atsConfidence: String(result.ats_confidence || company.atsConfidence || ""),
      status,
      confidenceScore: Math.max(0, Math.min(100, Number(result.career_confidence_score || 0))),
      verificationReason: String(result.career_evidence_reason || result.ats_evidence_reason || result.detection_error || "Career + ATS engine completed without a detailed reason."),
      verificationSource: cacheHit ? "Engine cache" : Boolean(result.playwright_used) ? "Playwright + fingerprint verification" : "Static crawler + fingerprint verification",
      evidenceUrl: String(result.ats_evidence_url || result.career_evidence_url || result.career_url || company.evidenceUrl || ""),
      detectionMethod,
      pagesChecked: Number(result.pages_checked || 0),
      staticPagesChecked: Number(result.static_pages_checked || 0),
      browserPagesChecked: Number(result.browser_pages_checked || 0),
      cacheHit,
      playwrightUsed: Boolean(result.playwright_used),
      lastCheckedAt: new Date().toISOString(),
      engineDurationMs: Number(payload.duration_ms || (Date.now() - started)),
    };
  } catch (error) {
    return {
      ...company,
      status: "needs_manual_review",
      confidenceScore: 35,
      verificationReason: error instanceof Error ? error.message : "Career + ATS engine request failed.",
      verificationSource: "Engine error",
      detectionMethod: "engine_request_failed",
      lastCheckedAt: new Date().toISOString(),
      engineDurationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, action: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await action(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function patchHubSpotCompany(companyId: string, properties: Record<string, string>) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured");
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(companyId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HubSpot update failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
}

async function pushVerifiedFields(company: CareerCompany, manual = false): Promise<CareerCompany> {
  if (process.env.DEMO_MODE === "true") throw new Error("HubSpot writes are disabled in DEMO_MODE");
  if (company.status !== "found_verified" || !company.careerPageUrl) {
    if (manual) throw new Error("Only Found & Verified results can be pushed to HubSpot");
    return company;
  }
  if (!manual && company.confidenceScore < 90) return company;

  const current = (await batchRead("companies", [company.companyId], [
    "career_page_url",
    "detected_ats",
    "ats_status",
    "ats_confidence",
    "ats_evidence_url",
    "ats_evidence_reason",
    "career_portal_type",
  ]))[0];
  if (!current) throw new Error("HubSpot company could not be re-read");

  const existingCareer = value(current, "career_page_url");
  if (existingCareer && existingCareer !== company.careerPageUrl) {
    return {
      ...company,
      hubspotPushStatus: "skipped",
      verificationReason: `${company.verificationReason} HubSpot already has a different Career Page; no overwrite was performed.`.trim(),
    };
  }

  const properties: Record<string, string> = {};
  if (!existingCareer) properties.career_page_url = company.careerPageUrl;
  if (company.detectedAts && !value(current, "detected_ats")) properties.detected_ats = company.detectedAts;
  if (company.detectedAts && !value(current, "ats_status")) properties.ats_status = "detected";
  if (company.atsConfidence && company.detectedAts && !value(current, "ats_confidence")) properties.ats_confidence = company.atsConfidence;
  if (company.evidenceUrl && company.detectedAts && !value(current, "ats_evidence_url")) properties.ats_evidence_url = company.evidenceUrl;
  if (company.verificationReason && company.detectedAts && !value(current, "ats_evidence_reason")) properties.ats_evidence_reason = company.verificationReason.slice(0, 1000);
  if (!value(current, "career_portal_type")) properties.career_portal_type = company.detectedAts ? "vendor_hosted_portal" : "basic_jobs_page";

  if (!Object.keys(properties).length) {
    return { ...company, hubspotPushStatus: "skipped", hubspotPushedAt: new Date().toISOString() };
  }

  await patchHubSpotCompany(company.companyId, properties);
  return { ...company, hubspotPushStatus: "pushed", hubspotPushedAt: new Date().toISOString() };
}

export async function runCareerBatch(input: { limit?: number; companyIds?: string[]; forceRefresh?: boolean } = {}) {
  const companies = await getCareerPortfolio(true);
  const requestedIds = new Set((input.companyIds || []).map(String));
  const limit = Math.max(1, Math.min(100, Number(input.limit || DEFAULT_SCAN_LIMIT)));
  const eligible = companies.filter((company) => {
    if (requestedIds.size) return requestedIds.has(company.companyId);
    return needsEngineScan(company);
  }).slice(0, limit);

  const processed = await mapConcurrent(eligible, SCAN_CONCURRENCY, async (company) => {
    const processing = { ...company, status: "processing" as CareerStatus };
    await saveCompany(processing);
    let result = await callCareerEngine(company, Boolean(input.forceRefresh));
    if (AUTO_PUSH && result.status === "found_verified") {
      try {
        result = await pushVerifiedFields(result, false);
      } catch (error) {
        result = {
          ...result,
          hubspotPushStatus: "error",
          verificationReason: `${result.verificationReason} Auto-push failed: ${error instanceof Error ? error.message : "unknown error"}`.trim(),
        };
      }
    }
    await saveCompany(result);
    return result;
  });

  portfolioCache = null;
  const refreshed = await getCareerPortfolio(true);
  return {
    processed,
    summary: summarizeCareerPortfolio(refreshed),
    remainingEligible: refreshed.filter(needsEngineScan).length,
    autoPushEnabled: AUTO_PUSH,
  };
}

export async function pushCareerResult(companyId: string) {
  if (process.env.DEMO_MODE === "true") throw new Error("HubSpot writes are disabled in DEMO_MODE");
  const portfolio = await getCareerPortfolio(true);
  const company = portfolio.find((item) => item.companyId === String(companyId));
  if (!company) throw new Error("Company is not in the Career Intelligence portfolio");
  const pushed = await pushVerifiedFields(company, true);
  await saveCompany(pushed);
  portfolioCache = null;
  return pushed;
}

export async function setCareerReview(companyId: string, action: "approve" | "reject", careerPageUrl?: string) {
  const portfolio = await getCareerPortfolio(true);
  const company = portfolio.find((item) => item.companyId === String(companyId));
  if (!company) throw new Error("Company is not in the Career Intelligence portfolio");
  if (action === "approve") {
    const approvedUrl = String(careerPageUrl || company.careerPageUrl || company.evidenceUrl || "").trim();
    if (!approvedUrl) throw new Error("A Career Page URL is required to approve this result");
    const approved: CareerCompany = {
      ...company,
      careerPageUrl: approvedUrl,
      status: "found_verified",
      confidenceScore: Math.max(company.confidenceScore, 95),
      verificationReason: `Manually approved. ${company.verificationReason}`.trim(),
      verificationSource: "Manual approval",
      evidenceUrl: approvedUrl,
      lastCheckedAt: new Date().toISOString(),
    };
    await saveCompany(approved);
    portfolioCache = null;
    return approved;
  }

  const rejected: CareerCompany = {
    ...company,
    careerPageUrl: "",
    status: "no_public_career_page",
    confidenceScore: Math.max(company.confidenceScore, 90),
    verificationReason: `Manually reviewed and rejected as a Career Page candidate. ${company.verificationReason}`.trim(),
    verificationSource: "Manual review",
    lastCheckedAt: new Date().toISOString(),
  };
  await saveCompany(rejected);
  portfolioCache = null;
  return rejected;
}
