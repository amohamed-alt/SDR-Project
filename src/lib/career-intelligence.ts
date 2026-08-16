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
const ENGINE_URL = process.env.CAREER_ENGINE_URL || "http://gtm-ats-browser:3000/career-detect";
const ENGINE_TIMEOUT_MS = Math.max(10_000, Number(process.env.CAREER_ENGINE_TIMEOUT_MS || 90_000));
const DEFAULT_SCAN_LIMIT = Math.max(1, Math.min(100, Number(process.env.CAREER_SCAN_LIMIT || 25)));
const SCAN_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.CAREER_SCAN_CONCURRENCY || 6)));
const PORTFOLIO_CACHE_MS = Math.max(10_000, Number(process.env.CAREER_PORTFOLIO_CACHE_MS || 60_000));

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
  let status: CareerStatus = "needs_research";
  let reason = "Waiting for Career Intelligence scan.";
  if (!domain && isPlaceholderCompany(companyName)) {
    status = "insufficient_company_data";
    reason = "No usable domain and the company identity is blank or a placeholder.";
  } else if (!domain) {
    status = "needs_manual_review";
    reason = "Company has no usable domain; identity resolution is required before crawling.";
  }

  return {
    companyId: String(record.id),
    companyName,
    domain,
    website,
    careerPageUrl: value(record, "career_page_url"),
    detectedAts: value(record, "detected_ats"),
    atsStatus: value(record, "ats_status"),
    atsConfidence: value(record, "ats_confidence"),
    status,
    confidenceScore: status === "insufficient_company_data" ? 99 : status === "needs_manual_review" ? 40 : 0,
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
    { id: "demo-1", name: "YMCO", domain: "ymco.sa", status: "found_verified" as CareerStatus, career: "https://ymco.sa/?page_id=5534", ats: "" },
    { id: "demo-2", name: "Example Gulf Holdings", domain: "example-gulf.com", status: "needs_research" as CareerStatus, career: "", ats: "" },
    { id: "demo-3", name: "Arabic Example", domain: "example.sa", status: "needs_manual_review" as CareerStatus, career: "", ats: "" },
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
    verificationReason: item.status === "found_verified" ? "Verified employer career page." : "Demo record for dashboard validation.",
    verificationSource: "Demo",
    evidenceUrl: item.career,
    detectionMethod: item.status === "found_verified" ? "static_career_verified" : "",
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
  const records = await searchAll(
    "companies",
    COMPANY_PROPERTIES,
    [{ propertyName: "career_page_url", operator: "NOT_HAS_PROPERTY" }],
    ["hs_object_id"],
  );
  return records.map(blankCompany);
}

export async function getCareerPortfolio(force = false): Promise<CareerCompany[]> {
  if (!force && portfolioCache && portfolioCache.expiresAt > Date.now()) return portfolioCache.companies.map((item) => ({ ...item }));
  const [hubspotCompanies, store] = await Promise.all([loadHubSpotPortfolio(), loadStore()]);
  const merged = new Map<string, CareerCompany>();

  for (const company of hubspotCompanies) {
    const stored = store.records[company.companyId];
    merged.set(company.companyId, stored ? { ...company, ...stored, companyName: company.companyName, domain: company.domain || stored.domain, website: company.website || stored.website, hubspotUrl: company.hubspotUrl } : company);
  }

  // Keep completed records visible after they have been pushed to HubSpot and therefore
  // no longer match the "career_page_url missing" search.
  for (const stored of Object.values(store.records)) {
    if (!merged.has(stored.companyId)) merged.set(stored.companyId, { ...stored });
  }

  const companies = [...merged.values()].sort((a, b) => {
    const priority = (status: CareerStatus) => status === "needs_research" ? 0 : status === "needs_manual_review" ? 1 : status === "processing" ? 2 : 3;
    return priority(a.status) - priority(b.status) || a.companyName.localeCompare(b.companyName);
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
    remaining: Math.max(0, total - completed),
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
    return { ...company, status, confidenceScore: status === "insufficient_company_data" ? 99 : 40, verificationReason: status === "insufficient_company_data" ? "No usable company identity or domain." : "No domain is available for automated crawling.", verificationSource: "Data validation", lastCheckedAt: new Date().toISOString() };
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
        force_refresh: forceRefresh,
        max_static_pages: 30,
        max_browser_steps: 8,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as CareerEngineResponse;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Career engine returned HTTP ${response.status}`);
    const result = payload.result || {};
    const status = engineStatus(String(result.career_status || ""));
    const detectionMethod = String(result.detection_method || "");
    const cacheHit = Boolean(result.cache_hit) || detectionMethod.startsWith("cache:");
    return {
      ...company,
      careerPageUrl: String(result.career_url || company.careerPageUrl || ""),
      detectedAts: String(result.detected_ats || company.detectedAts || ""),
      atsStatus: String(result.ats_status || company.atsStatus || ""),
      atsConfidence: String(result.ats_confidence || company.atsConfidence || ""),
      status,
      confidenceScore: Math.max(0, Math.min(100, Number(result.career_confidence_score || 0))),
      verificationReason: String(result.career_evidence_reason || result.ats_evidence_reason || result.detection_error || "Career engine completed without a detailed reason."),
      verificationSource: cacheHit ? "Engine cache" : Boolean(result.playwright_used) ? "Playwright verification" : "Static crawler",
      evidenceUrl: String(result.career_evidence_url || result.ats_evidence_url || result.career_url || ""),
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
      verificationReason: error instanceof Error ? error.message : "Career engine request failed.",
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

export async function runCareerBatch(input: { limit?: number; companyIds?: string[]; forceRefresh?: boolean } = {}) {
  const companies = await getCareerPortfolio(true);
  const requestedIds = new Set((input.companyIds || []).map(String));
  const limit = Math.max(1, Math.min(100, Number(input.limit || DEFAULT_SCAN_LIMIT)));
  const eligible = companies.filter((company) => {
    if (requestedIds.size) return requestedIds.has(company.companyId);
    return company.status === "needs_research";
  }).slice(0, limit);

  const processed = await mapConcurrent(eligible, SCAN_CONCURRENCY, async (company) => {
    const processing = { ...company, status: "processing" as CareerStatus };
    await saveCompany(processing);
    const result = await callCareerEngine(company, Boolean(input.forceRefresh));
    await saveCompany(result);
    return result;
  });

  portfolioCache = null;
  const refreshed = await getCareerPortfolio(true);
  return { processed, summary: summarizeCareerPortfolio(refreshed), remainingEligible: refreshed.filter((company) => company.status === "needs_research").length };
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

export async function pushCareerResult(companyId: string) {
  if (process.env.DEMO_MODE === "true") throw new Error("HubSpot writes are disabled in DEMO_MODE");
  const portfolio = await getCareerPortfolio(true);
  const company = portfolio.find((item) => item.companyId === String(companyId));
  if (!company) throw new Error("Company is not in the Career Intelligence portfolio");
  if (company.status !== "found_verified" || !company.careerPageUrl) throw new Error("Only Found & Verified results can be pushed to HubSpot");

  const current = (await batchRead("companies", [company.companyId], ["career_page_url", "detected_ats", "ats_status", "ats_confidence", "ats_evidence_url", "ats_evidence_reason", "career_portal_type"]))[0];
  if (!current) throw new Error("HubSpot company could not be re-read");
  const existingCareer = value(current, "career_page_url");
  if (existingCareer && existingCareer !== company.careerPageUrl) {
    const skipped = { ...company, hubspotPushStatus: "skipped" as const, verificationReason: `${company.verificationReason} HubSpot already has a different Career Page; no overwrite was performed.` };
    await saveCompany(skipped);
    portfolioCache = null;
    return skipped;
  }

  const properties: Record<string, string> = {};
  if (!existingCareer) properties.career_page_url = company.careerPageUrl;
  if (company.detectedAts && !value(current, "detected_ats")) properties.detected_ats = company.detectedAts;
  if (company.detectedAts && !value(current, "ats_status")) properties.ats_status = "detected";
  if (company.atsConfidence && !value(current, "ats_confidence")) properties.ats_confidence = company.atsConfidence;
  if (company.evidenceUrl && !value(current, "ats_evidence_url") && company.detectedAts) properties.ats_evidence_url = company.evidenceUrl;
  if (company.verificationReason && !value(current, "ats_evidence_reason") && company.detectedAts) properties.ats_evidence_reason = company.verificationReason.slice(0, 1000);
  if (!value(current, "career_portal_type")) properties.career_portal_type = company.detectedAts ? "vendor_hosted_portal" : "basic_jobs_page";

  if (Object.keys(properties).length) await patchHubSpotCompany(company.companyId, properties);
  const pushed = { ...company, hubspotPushStatus: "pushed" as const, hubspotPushedAt: new Date().toISOString() };
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
