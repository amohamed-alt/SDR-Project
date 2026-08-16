import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { COMPANY_PROPERTIES, hubspotRecordUrl } from "@/lib/config";
import { searchAll, type SearchFilter } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";
import {
  calculateHiringScore,
  detectHiringSource,
  hiringStatus,
  hiringTrend,
  isHrOrRecruitingRole,
  mergeStoredJobs,
  normalizeTargetCountry,
  parseJobLinks,
  parseJobPostingJsonLd,
  shouldExcludeHiringCompany,
  type DiscoveredJob,
  type HiringSignalStatus,
  type HiringSource,
  type HiringTrend,
  type StoredHiringJob,
} from "@/lib/hiring-signals-core";

const STORE_VERSION = 1;
const DEFAULT_SCAN_LIMIT = 160;
const DEFAULT_CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2_500_000;
const MAX_JOB_HISTORY = 400;
const MAX_SNAPSHOTS = 60;
const MAX_PROGRESS_CHUNK = 30;
const MAX_DIRECT_JOBS = 500;
const TARGET_COUNTRY_VALUES = [
  "Saudi Arabia",
  "United Arab Emirates",
  "KSA",
  "UAE",
  "SA",
  "AE",
];

const HIRING_COMPANY_PROPERTIES = [
  ...COMPANY_PROPERTIES,
  "ats_evidence_url",
  "gtm_hiring_signal",
  "account_type",
] as const;

export interface HiringSnapshotPoint {
  checkedAt: string;
  activeJobs: number;
  newJobs7d: number;
  score: number;
}

export interface HiringCompanySignal {
  companyId: string;
  name: string;
  domain: string;
  country: "Saudi Arabia" | "United Arab Emirates";
  careerPageUrl: string;
  ats: string;
  hubspotHiringSignal: string;
  hubspotUrl: string;
  sourceKind: HiringSource["kind"];
  sourceConfidence: HiringSource["confidence"];
  sourceUrl: string;
  activeJobs: number;
  previousActiveJobs: number;
  newJobs7d: number;
  newJobs30d: number;
  closedJobs7d: number;
  hiringScore: number;
  hiringStatus: HiringSignalStatus;
  trend: HiringTrend;
  topDepartments: string[];
  topLocations: string[];
  lastCheckedAt: string;
  lastSuccessfulCheckAt: string;
  scanStatus: "success" | "inconclusive" | "error" | "pending";
  error: string;
  jobs: StoredHiringJob[];
  snapshots: HiringSnapshotPoint[];
}

export interface HiringStore {
  version: number;
  generatedAt: string;
  cursor: number;
  run: {
    startedAt: string;
    completedAt: string;
    scanned: number;
    succeeded: number;
    inconclusive: number;
    failed: number;
    eligibleCompanies: number;
    scanLimit: number;
  };
  companies: HiringCompanySignal[];
}

interface ScanResponse {
  jobs: DiscoveredJob[];
  sourceUrl: string;
  confidence: HiringSource["confidence"];
  reliableEmpty: boolean;
}

interface GreenhouseResponse {
  jobs?: Array<{
    id?: number | string;
    title?: string;
    absolute_url?: string;
    updated_at?: string;
    location?: { name?: string };
    departments?: Array<{ name?: string }>;
    offices?: Array<{ name?: string; location?: string }>;
  }>;
}

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
}

interface SmartRecruitersResponse {
  totalFound?: number;
  content?: Array<{
    id?: string;
    name?: string;
    uuid?: string;
    refNumber?: string;
    releasedDate?: string;
    company?: { identifier?: string; name?: string };
    location?: { city?: string; region?: string; country?: string; countryCode?: string };
    department?: { label?: string; id?: string };
    typeOfEmployment?: { label?: string };
  }>;
}

interface AshbyResponse {
  jobs?: Array<{
    id?: string;
    title?: string;
    location?: string;
    department?: string;
    team?: string;
    publishedAt?: string;
    jobUrl?: string;
    applyUrl?: string;
    isListed?: boolean;
  }>;
}

interface RecruiteeOffer {
  id?: number | string;
  title?: string;
  slug?: string;
  careers_url?: string;
  url?: string;
  location?: unknown;
  department?: unknown;
  published_at?: string;
  created_at?: string;
}

interface RecruiteeResponse {
  offers?: RecruiteeOffer[];
  jobs?: RecruiteeOffer[];
}

interface WorkableJob {
  id?: string;
  shortcode?: string;
  title?: string;
  state?: string;
  department?: unknown;
  url?: string;
  shortlink?: string;
  location?: unknown;
  created_at?: string;
}

interface WorkableResponse {
  jobs?: WorkableJob[];
}

interface WorkdayJob {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayJob[];
}

let refreshInFlight: Promise<HiringStore> | null = null;

function value(record: HubSpotRecord, key: string) {
  return record.properties[key]?.trim() ?? "";
}

function storePath() {
  return process.env.HIRING_SNAPSHOT_PATH || "/app/data/hiring-signals.json";
}

function positiveInteger(raw: string | undefined, fallback: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function emptyStore(): HiringStore {
  return {
    version: STORE_VERSION,
    generatedAt: "",
    cursor: 0,
    run: {
      startedAt: "",
      completedAt: "",
      scanned: 0,
      succeeded: 0,
      inconclusive: 0,
      failed: 0,
      eligibleCompanies: 0,
      scanLimit: positiveInteger(process.env.HIRING_SCAN_LIMIT, DEFAULT_SCAN_LIMIT, 5_000),
    },
    companies: [],
  };
}

export async function getHiringStore(): Promise<HiringStore> {
  try {
    const raw = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw) as HiringStore;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.companies)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

async function persistStore(store: HiringStore) {
  const target = storePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Talentera-Hiring-Intelligence/1.0 (+public-career-page-monitor)",
    },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Career page returned HTTP ${response.status}`);
  const text = await response.text();
  return { text: text.slice(0, MAX_HTML_BYTES), finalUrl: response.url || url };
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("User-Agent")) headers.set("User-Agent", "Talentera-Hiring-Intelligence/1.0 (+public-career-page-monitor)");
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Hiring source returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function isoFromMillis(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return "";
  return new Date(value).toISOString();
}

function isoIfDate(value: string | undefined) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function textFromUnknown(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (typeof input === "number") return String(input);
  if (Array.isArray(input)) return input.map(textFromUnknown).filter(Boolean).join(" · ");
  if (!input || typeof input !== "object") return "";
  const object = input as Record<string, unknown>;
  const direct = ["name", "label", "title", "location_str", "locationStr", "value"]
    .map((key) => textFromUnknown(object[key]))
    .find(Boolean);
  if (direct) return direct;
  return ["city", "region", "state", "country", "countryCode", "country_code"]
    .map((key) => textFromUnknown(object[key]))
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .join(", ");
}

async function scanGreenhouse(source: HiringSource): Promise<ScanResponse> {
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.key)}/jobs?content=true`;
  const payload = await fetchJson<GreenhouseResponse>(endpoint);
  const jobs: DiscoveredJob[] = (payload.jobs ?? []).map((job) => ({
    externalId: String(job.id ?? job.absolute_url ?? job.title ?? ""),
    title: job.title ?? "",
    location: job.location?.name || job.offices?.map((office) => office.location || office.name || "").filter(Boolean).join(" · ") || "",
    department: job.departments?.map((department) => department.name || "").filter(Boolean).join(" · ") || "",
    url: job.absolute_url || source.url,
    postedAt: job.updated_at || "",
  }));
  return { jobs, sourceUrl: endpoint, confidence: "high", reliableEmpty: true };
}

async function scanLever(source: HiringSource): Promise<ScanResponse> {
  const european = /jobs\.eu\.lever\.co|api\.eu\.lever\.co/i.test(source.url);
  const host = european ? "api.eu.lever.co" : "api.lever.co";
  const endpoint = `https://${host}/v0/postings/${encodeURIComponent(source.key)}?mode=json`;
  const payload = await fetchJson<LeverPosting[]>(endpoint);
  const jobs: DiscoveredJob[] = (Array.isArray(payload) ? payload : []).map((job) => ({
    externalId: job.id || job.hostedUrl || job.applyUrl || job.text || "",
    title: job.text || "",
    location: job.categories?.location || "",
    department: job.categories?.department || job.categories?.team || "",
    url: job.hostedUrl || job.applyUrl || source.url,
    postedAt: isoFromMillis(job.createdAt),
  }));
  return { jobs, sourceUrl: endpoint, confidence: "high", reliableEmpty: true };
}

async function scanSmartRecruiters(source: HiringSource): Promise<ScanResponse> {
  const endpoint = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.key)}/postings?limit=100&offset=0`;
  const payload = await fetchJson<SmartRecruitersResponse>(endpoint);
  const jobs: DiscoveredJob[] = (payload.content ?? []).map((job) => {
    const location = [job.location?.city, job.location?.region, job.location?.country || job.location?.countryCode].filter(Boolean).join(", ");
    const id = job.id || job.uuid || job.refNumber || "";
    return {
      externalId: id,
      title: job.name || "",
      location,
      department: job.department?.label || "",
      url: id ? `https://jobs.smartrecruiters.com/${encodeURIComponent(source.key)}/${encodeURIComponent(id)}` : source.url,
      postedAt: job.releasedDate || "",
    };
  });
  return { jobs, sourceUrl: endpoint, confidence: "high", reliableEmpty: true };
}

async function scanAshby(source: HiringSource): Promise<ScanResponse> {
  const key = source.key.replace(/^ashby:/, "");
  if (!key) throw new Error("Ashby job-board key could not be determined");
  const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(key)}`;
  const payload = await fetchJson<AshbyResponse>(endpoint);
  const jobs: DiscoveredJob[] = (payload.jobs ?? [])
    .filter((job) => job.isListed !== false)
    .map((job) => ({
      externalId: job.id || job.jobUrl || job.applyUrl || job.title || "",
      title: job.title || "",
      location: job.location || "",
      department: job.department || job.team || "",
      url: job.jobUrl || job.applyUrl || source.url,
      postedAt: isoIfDate(job.publishedAt),
    }));
  return { jobs, sourceUrl: endpoint, confidence: "high", reliableEmpty: true };
}

async function scanRecruitee(source: HiringSource): Promise<ScanResponse> {
  const key = source.key.replace(/^recruitee:/, "");
  if (!key) throw new Error("Recruitee company key could not be determined");
  const endpoint = `https://${encodeURIComponent(key)}.recruitee.com/api/offers/`;
  const payload = await fetchJson<RecruiteeResponse | RecruiteeOffer[]>(endpoint);
  const offers = Array.isArray(payload) ? payload : payload.offers ?? payload.jobs ?? [];
  const jobs: DiscoveredJob[] = offers.map((job) => ({
    externalId: String(job.id ?? job.slug ?? job.careers_url ?? job.url ?? job.title ?? ""),
    title: job.title || "",
    location: textFromUnknown(job.location),
    department: textFromUnknown(job.department),
    url: job.careers_url || job.url || (job.slug ? `https://${key}.recruitee.com/o/${job.slug}` : source.url),
    postedAt: isoIfDate(job.published_at || job.created_at),
  }));
  return { jobs, sourceUrl: endpoint, confidence: "high", reliableEmpty: true };
}

async function scanWorkable(source: HiringSource): Promise<ScanResponse> {
  const key = source.key.replace(/^workable:/, "");
  if (!key) throw new Error("Workable account key could not be determined");
  const endpoint = `https://www.workable.com/api/accounts/${encodeURIComponent(key)}?details=true`;
  const payload = await fetchJson<WorkableResponse | WorkableJob[]>(endpoint);
  const records = Array.isArray(payload) ? payload : payload.jobs ?? [];
  const jobs: DiscoveredJob[] = records
    .filter((job) => !job.state || /published|active|open/i.test(job.state))
    .map((job) => ({
      externalId: job.id || job.shortcode || job.url || job.shortlink || job.title || "",
      title: job.title || "",
      location: textFromUnknown(job.location),
      department: textFromUnknown(job.department),
      url: job.url || job.shortlink || source.url,
      postedAt: isoIfDate(job.created_at),
    }));
  return { jobs, sourceUrl: endpoint, confidence: "high", reliableEmpty: true };
}

function workdayParts(source: HiringSource) {
  const raw = source.key.replace(/^workday:/, "");
  const [keyTenant, keySite] = raw.split("|", 2);
  const parsed = new URL(source.url);
  const tenant = keyTenant || parsed.hostname.split(".")[0];
  const cxs = parsed.pathname.match(/\/wday\/cxs\/([^/]+)\/([^/]+)\/jobs/i);
  const pathSegments = parsed.pathname.split("/").filter(Boolean).filter((segment) => !/^[a-z]{2}[-_][a-z]{2}$/i.test(segment));
  const site = keySite || cxs?.[2] || pathSegments[0] || "";
  if (!tenant || !site) throw new Error("Workday tenant or career-site key could not be determined");
  return { origin: parsed.origin, tenant: cxs?.[1] || tenant, site };
}

async function scanWorkday(source: HiringSource): Promise<ScanResponse> {
  const { origin, tenant, site } = workdayParts(source);
  const endpoint = `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
  const jobs: DiscoveredJob[] = [];
  const pageSize = 20;

  for (let offset = 0; offset < MAX_DIRECT_JOBS; offset += pageSize) {
    const payload = await fetchJson<WorkdayResponse>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: pageSize, offset, searchText: "" }),
    });
    const postings = payload.jobPostings ?? [];
    for (const job of postings) {
      const url = job.externalPath ? new URL(job.externalPath, origin).toString() : source.url;
      jobs.push({
        externalId: job.externalPath || `${job.title || "job"}|${job.locationsText || ""}`,
        title: job.title || "",
        location: job.locationsText || "",
        department: "",
        url,
        postedAt: isoIfDate(job.postedOn),
      });
    }
    if (!postings.length || postings.length < pageSize || (payload.total !== undefined && offset + postings.length >= payload.total)) break;
  }

  return { jobs, sourceUrl: endpoint, confidence: "high", reliableEmpty: true };
}

async function scanGeneric(source: HiringSource): Promise<ScanResponse> {
  if (!source.url) throw new Error("No career page URL available");
  const page = await fetchText(source.url);
  const structured = parseJobPostingJsonLd(page.text, page.finalUrl);
  if (structured.length) return { jobs: structured, sourceUrl: page.finalUrl, confidence: "medium", reliableEmpty: true };

  const links = parseJobLinks(page.text, page.finalUrl);
  if (links.length) return { jobs: links, sourceUrl: page.finalUrl, confidence: "low", reliableEmpty: false };

  const explicitEmpty = /(?:no|without)\s+(?:current\s+)?(?:openings|vacancies|positions|jobs)|(?:currently|presently)\s+(?:have|has|with)\s+no\s+(?:openings|vacancies|positions|jobs)/i.test(page.text);
  return { jobs: [], sourceUrl: page.finalUrl, confidence: "low", reliableEmpty: explicitEmpty };
}

async function scanVendor(source: HiringSource): Promise<ScanResponse> {
  const result = await scanGeneric(source);
  return { ...result, confidence: result.confidence === "low" ? "medium" : result.confidence };
}

async function directWithGenericFallback(source: HiringSource, direct: () => Promise<ScanResponse>) {
  try {
    return await direct();
  } catch {
    return scanGeneric(source);
  }
}

async function scanSource(source: HiringSource) {
  if (source.kind === "greenhouse") return scanGreenhouse(source);
  if (source.kind === "lever") return scanLever(source);
  if (source.kind === "smartrecruiters") return scanSmartRecruiters(source);
  if (source.key.startsWith("ashby:")) return directWithGenericFallback(source, () => scanAshby(source));
  if (source.key.startsWith("recruitee:")) return directWithGenericFallback(source, () => scanRecruitee(source));
  if (source.key.startsWith("workable:")) return directWithGenericFallback(source, () => scanWorkable(source));
  if (source.key.startsWith("workday:")) return directWithGenericFallback(source, () => scanWorkday(source));
  if (source.key.startsWith("vendor:")) return scanVendor(source);
  return scanGeneric(source);
}

function topValues(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

function withinDays(date: string, days: number, nowMs: number) {
  if (!date) return false;
  const timestamp = new Date(date).getTime();
  return Number.isFinite(timestamp) && timestamp >= nowMs - days * 86_400_000;
}

function metricsFromJobs(jobs: StoredHiringJob[], previousActiveJobs: number, nowMs: number) {
  const active = jobs.filter((job) => job.status === "active");
  const newJobs7d = active.filter((job) => withinDays(job.firstSeenAt, 7, nowMs)).length;
  const newJobs30d = active.filter((job) => withinDays(job.firstSeenAt, 30, nowMs)).length;
  const closedJobs7d = jobs.filter((job) => job.status === "closed" && withinDays(job.closedAt, 7, nowMs)).length;
  const topDepartments = topValues(active.map((job) => job.department));
  const topLocations = topValues(active.map((job) => job.location));
  const score = calculateHiringScore({
    activeJobs: active.length,
    newJobs7d,
    previousActiveJobs,
    hasHrJobs: active.some((job) => isHrOrRecruitingRole(job.title)),
    locationCount: new Set(active.map((job) => job.location.trim()).filter(Boolean)).size,
  });
  return {
    activeJobs: active.length,
    newJobs7d,
    newJobs30d,
    closedJobs7d,
    topDepartments,
    topLocations,
    hiringScore: score,
    hiringStatus: hiringStatus(score),
    trend: hiringTrend(active.length, previousActiveJobs),
  };
}

function companyIdentity(record: HubSpotRecord) {
  const country = normalizeTargetCountry(value(record, "gtm_country") || value(record, "country"));
  const careerPageUrl = value(record, "career_page_url");
  const evidenceUrl = value(record, "ats_evidence_url");
  return {
    companyId: record.id,
    name: value(record, "name") || "Unnamed company",
    domain: value(record, "domain"),
    country,
    careerPageUrl,
    evidenceUrl,
    accountType: value(record, "account_type"),
    ats: value(record, "detected_ats") || value(record, "ats_status"),
    hubspotHiringSignal: value(record, "gtm_hiring_signal"),
  };
}

function pendingSignal(record: HubSpotRecord): HiringCompanySignal | null {
  const identity = companyIdentity(record);
  if (shouldExcludeHiringCompany({ name: identity.name, domain: identity.domain, accountType: identity.accountType })) return null;
  if (!identity.country || (!identity.careerPageUrl && !identity.evidenceUrl)) return null;
  const source = detectHiringSource(identity.careerPageUrl, identity.ats, identity.evidenceUrl);
  return {
    companyId: identity.companyId,
    name: identity.name,
    domain: identity.domain,
    country: identity.country as "Saudi Arabia" | "United Arab Emirates",
    careerPageUrl: identity.careerPageUrl || identity.evidenceUrl,
    ats: identity.ats,
    hubspotHiringSignal: identity.hubspotHiringSignal,
    hubspotUrl: hubspotRecordUrl("company", identity.companyId),
    sourceKind: source.kind,
    sourceConfidence: source.confidence,
    sourceUrl: source.url,
    activeJobs: 0,
    previousActiveJobs: 0,
    newJobs7d: 0,
    newJobs30d: 0,
    closedJobs7d: 0,
    hiringScore: 0,
    hiringStatus: "No Signal",
    trend: "No active hiring",
    topDepartments: [],
    topLocations: [],
    lastCheckedAt: "",
    lastSuccessfulCheckAt: "",
    scanStatus: "pending",
    error: "",
    jobs: [],
    snapshots: [],
  };
}

async function scanCompany(record: HubSpotRecord, previous: HiringCompanySignal | undefined, checkedAt: string): Promise<HiringCompanySignal> {
  const base = pendingSignal(record);
  if (!base) throw new Error("Company is outside the KSA/UAE acquisition hiring scope");
  const source = detectHiringSource(base.careerPageUrl, base.ats, value(record, "ats_evidence_url"));
  const previousActiveJobs = previous?.activeJobs ?? 0;

  try {
    const result = await scanSource(source);
    if (!result.jobs.length && !result.reliableEmpty) {
      return {
        ...(previous || base),
        ...base,
        previousActiveJobs,
        sourceKind: source.kind,
        sourceConfidence: result.confidence,
        sourceUrl: result.sourceUrl,
        lastCheckedAt: checkedAt,
        scanStatus: "inconclusive",
        error: "Career source loaded, but no reliable structured job list was detected.",
      };
    }

    const mergedJobs = mergeStoredJobs(previous?.jobs ?? [], result.jobs, checkedAt).slice(0, MAX_JOB_HISTORY);
    const metrics = metricsFromJobs(mergedJobs, previousActiveJobs, new Date(checkedAt).getTime());
    const snapshots = [
      ...(previous?.snapshots ?? []),
      { checkedAt, activeJobs: metrics.activeJobs, newJobs7d: metrics.newJobs7d, score: metrics.hiringScore },
    ].slice(-MAX_SNAPSHOTS);

    return {
      ...base,
      ...metrics,
      previousActiveJobs,
      sourceKind: source.kind,
      sourceConfidence: result.confidence,
      sourceUrl: result.sourceUrl,
      lastCheckedAt: checkedAt,
      lastSuccessfulCheckAt: checkedAt,
      scanStatus: "success",
      error: "",
      jobs: mergedJobs,
      snapshots,
    };
  } catch (error) {
    return {
      ...(previous || base),
      ...base,
      previousActiveJobs,
      sourceKind: source.kind,
      sourceConfidence: source.confidence,
      sourceUrl: source.url,
      lastCheckedAt: checkedAt,
      scanStatus: "error",
      error: error instanceof Error ? error.message.slice(0, 240) : "Unknown hiring scan error",
    };
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => runWorker()));
  return results;
}

function selectCycle<T>(items: T[], cursor: number, limit: number) {
  if (!items.length) return { selected: [] as T[], nextCursor: 0 };
  const count = Math.min(limit, items.length);
  const normalizedCursor = ((cursor % items.length) + items.length) % items.length;
  const selected: T[] = [];
  for (let index = 0; index < count; index += 1) selected.push(items[(normalizedCursor + index) % items.length]);
  return { selected, nextCursor: (normalizedCursor + count) % items.length };
}

function targetCountryFilters(propertyName: "country" | "gtm_country"): SearchFilter[] {
  return [{ propertyName, operator: "IN", values: TARGET_COUNTRY_VALUES }];
}

async function loadTargetCompanies() {
  const [countryRecords, gtmCountryRecords] = await Promise.all([
    searchAll("companies", HIRING_COMPANY_PROPERTIES, targetCountryFilters("country")),
    searchAll("companies", HIRING_COMPANY_PROPERTIES, targetCountryFilters("gtm_country")),
  ]);
  const recordsById = new Map<string, HubSpotRecord>();
  for (const record of [...countryRecords, ...gtmCountryRecords]) recordsById.set(record.id, record);
  return [...recordsById.values()];
}

function companiesFromMap(nextById: Map<string, HiringCompanySignal>, eligibleIds: Set<string>) {
  return [...nextById.values()]
    .filter((company) => eligibleIds.has(company.companyId))
    .sort((a, b) => b.hiringScore - a.hiringScore || b.newJobs7d - a.newJobs7d || b.activeJobs - a.activeJobs || a.name.localeCompare(b.name));
}

function buildStore(args: {
  nextById: Map<string, HiringCompanySignal>;
  eligibleIds: Set<string>;
  startedAt: string;
  completedAt: string;
  cursor: number;
  scanLimit: number;
  eligibleCompanies: number;
  scanned: HiringCompanySignal[];
}): HiringStore {
  return {
    version: STORE_VERSION,
    generatedAt: new Date().toISOString(),
    cursor: args.cursor,
    run: {
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      scanned: args.scanned.length,
      succeeded: args.scanned.filter((company) => company.scanStatus === "success").length,
      inconclusive: args.scanned.filter((company) => company.scanStatus === "inconclusive").length,
      failed: args.scanned.filter((company) => company.scanStatus === "error").length,
      eligibleCompanies: args.eligibleCompanies,
      scanLimit: args.scanLimit,
    },
    companies: companiesFromMap(args.nextById, args.eligibleIds),
  };
}

async function runRefresh() {
  const previousStore = await getHiringStore();
  const previousById = new Map(previousStore.companies.map((company) => [company.companyId, company]));
  const startedAt = new Date().toISOString();
  const scanLimit = positiveInteger(process.env.HIRING_SCAN_LIMIT, DEFAULT_SCAN_LIMIT, 5_000);
  const concurrency = positiveInteger(process.env.HIRING_SCAN_CONCURRENCY, DEFAULT_CONCURRENCY, 20);
  const chunkSize = Math.min(MAX_PROGRESS_CHUNK, Math.max(concurrency * 2, 10));

  const records = await loadTargetCompanies();
  const eligible = records
    .filter((record) => pendingSignal(record))
    .sort((a, b) => Number(a.id) - Number(b.id));
  const cycle = selectCycle(eligible, previousStore.cursor, scanLimit);
  const eligibleIds = new Set(eligible.map((record) => record.id));
  const nextById = new Map(previousStore.companies.map((company) => [company.companyId, company]));

  for (const record of eligible) {
    if (!nextById.has(record.id)) {
      const pending = pendingSignal(record);
      if (pending) nextById.set(record.id, pending);
    }
  }

  const scanned: HiringCompanySignal[] = [];

  await persistStore(buildStore({
    nextById,
    eligibleIds,
    startedAt,
    completedAt: "",
    cursor: previousStore.cursor,
    scanLimit,
    eligibleCompanies: eligible.length,
    scanned,
  }));

  for (let offset = 0; offset < cycle.selected.length; offset += chunkSize) {
    const chunk = cycle.selected.slice(offset, offset + chunkSize);
    const checkedAt = new Date().toISOString();
    const results = await mapConcurrent(chunk, concurrency, (record) => scanCompany(record, previousById.get(record.id), checkedAt));
    for (const result of results) nextById.set(result.companyId, result);
    scanned.push(...results);

    await persistStore(buildStore({
      nextById,
      eligibleIds,
      startedAt,
      completedAt: "",
      cursor: previousStore.cursor,
      scanLimit,
      eligibleCompanies: eligible.length,
      scanned,
    }));
  }

  const store = buildStore({
    nextById,
    eligibleIds,
    startedAt,
    completedAt: new Date().toISOString(),
    cursor: cycle.nextCursor,
    scanLimit,
    eligibleCompanies: eligible.length,
    scanned,
  });
  await persistStore(store);
  return store;
}

export async function refreshHiringSignals() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
