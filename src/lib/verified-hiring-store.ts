import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getHiringStore,
  type HiringCompanySignal,
  type HiringStore,
} from "@/lib/hiring-signals";
import {
  calculateHiringScore,
  hiringStatus,
  isHrOrRecruitingRole,
  type DiscoveredJob,
  type StoredHiringJob,
} from "@/lib/hiring-signals-core";
import {
  verifyGenericHiringJobs,
  type HiringVerificationMethod,
  type HiringVerificationResult,
} from "@/lib/hiring-verification";

const CACHE_VERSION = 1;
const VERIFIED_STORE_VERSION = 1;
const DEFAULT_CACHE_TTL_HOURS = 24;
const DEFAULT_INCONCLUSIVE_TTL_HOURS = 2;
const DEFAULT_CONCURRENCY = 4;
const MAX_CACHE_ENTRIES = 2_000;
const MAX_STALE_VERIFIED_STORE_HOURS = 24;
const DAY_MS = 86_400_000;

type VerificationCoverage = "complete" | "partial" | "unknown";

type VerificationCacheEntry = {
  fingerprint: string;
  createdAt: number;
  expiresAt: number;
  result: HiringVerificationResult;
};

type VerificationCache = {
  version: 1;
  entries: Record<string, VerificationCacheEntry>;
};

type PersistedVerifiedStore = {
  version: 1;
  rawGeneratedAt: string;
  store: VerifiedHiringStore;
};

export type VerifiedHiringCompanySignal = HiringCompanySignal & {
  rawActiveJobs: number;
  rawNewJobs7d: number;
  rawNewJobs30d: number;
  rawJobsDetected: number;
  staleJobsExcluded: number;
  verificationMethod: HiringVerificationMethod;
  verificationConfidence: "high" | "medium" | "low";
  verificationCoverage: VerificationCoverage;
  verificationNote: string;
  webSearchVerified: boolean;
};

export type VerifiedHiringStore = Omit<HiringStore, "companies"> & {
  verificationGeneratedAt: string;
  companies: VerifiedHiringCompanySignal[];
};

let verificationInFlight: Promise<VerifiedHiringStore> | null = null;
let cacheQueue: Promise<void> = Promise.resolve();

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clean(value: unknown, max = 1_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cachePath() {
  return process.env.HIRING_VERIFICATION_CACHE_PATH || "/app/data/hiring-verification-cache.json";
}

function verifiedStorePath() {
  return process.env.VERIFIED_HIRING_STORE_PATH || "/app/data/verified-hiring-store.json";
}

function emptyCache(): VerificationCache {
  return { version: CACHE_VERSION, entries: {} };
}

async function withCacheLock<T>(action: () => Promise<T>) {
  const previous = cacheQueue;
  let release: (() => void) | undefined;
  cacheQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await action();
  } finally {
    release?.();
  }
}

async function readCache() {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ cachePath(), "utf8");
    const parsed = JSON.parse(raw) as VerificationCache;
    if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") return emptyCache();
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (!entry || entry.expiresAt <= now) delete parsed.entries[key];
    }
    return parsed;
  } catch {
    return emptyCache();
  }
}

async function writeCache(cache: VerificationCache) {
  const entries = Object.entries(cache.entries);
  if (entries.length > MAX_CACHE_ENTRIES) {
    entries.sort((a, b) => b[1].createdAt - a[1].createdAt);
    cache.entries = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
  }
  const target = cachePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(/* turbopackIgnore: true */ temp, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
  await rename(/* turbopackIgnore: true */ temp, /* turbopackIgnore: true */ target);
}

async function readPersistedVerifiedStore() {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ verifiedStorePath(), "utf8");
    const parsed = JSON.parse(raw) as PersistedVerifiedStore;
    if (parsed.version !== VERIFIED_STORE_VERSION || !parsed.store || !Array.isArray(parsed.store.companies)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persistVerifiedStore(rawGeneratedAt: string, store: VerifiedHiringStore) {
  const target = verifiedStorePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  const payload: PersistedVerifiedStore = { version: VERIFIED_STORE_VERSION, rawGeneratedAt, store };
  await writeFile(/* turbopackIgnore: true */ temp, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  await rename(/* turbopackIgnore: true */ temp, /* turbopackIgnore: true */ target);
}

function normalizedUrl(value: string) {
  const raw = clean(value, 1_500);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function activeRawJobs(company: HiringCompanySignal) {
  return company.jobs.filter((job) => job.status === "active");
}

function asDiscovered(job: StoredHiringJob): DiscoveredJob {
  return {
    externalId: job.externalId,
    title: job.title,
    location: job.location,
    department: job.department,
    url: job.url,
    postedAt: job.postedAt,
  };
}

function authoritativeLiveSource(company: HiringCompanySignal) {
  if (company.sourceKind !== "generic") return true;
  const source = clean(company.sourceUrl, 2_000).toLowerCase();
  return /api\.ashbyhq\.com\/posting-api\/job-board|\.recruitee\.com\/api\/offers|workable\.com\/api\/accounts|\/wday\/cxs\/[^/]+\/[^/]+\/jobs/.test(source);
}

function fingerprintFor(company: HiringCompanySignal, candidates: StoredHiringJob[]) {
  const payload = {
    companyId: company.companyId,
    domain: clean(company.domain, 300).toLowerCase(),
    careerPageUrl: normalizedUrl(company.careerPageUrl),
    sourceUrl: normalizedUrl(company.sourceUrl),
    scanStatus: company.scanStatus,
    sourceConfidence: company.sourceConfidence,
    jobs: candidates
      .map((job) => ({
        id: clean(job.externalId, 500),
        title: clean(job.title, 300),
        location: clean(job.location, 300),
        url: normalizedUrl(job.url),
        postedAt: clean(job.postedAt, 100),
      }))
      .sort((a, b) => `${a.id}|${a.url}|${a.title}`.localeCompare(`${b.id}|${b.url}|${b.title}`)),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function authoritativeResult(candidates: StoredHiringJob[]): HiringVerificationResult {
  return {
    jobs: candidates.map(asDiscovered),
    conclusive: true,
    method: "authoritative-ats",
    confidence: "high",
    rawCandidateCount: candidates.length,
    rejectedStaleCount: 0,
    webSearchUsed: false,
    note: "Current openings are read directly from a live public ATS endpoint; stale career-page HTML is not used for the count.",
  };
}

async function cachedGenericVerification(company: HiringCompanySignal, candidates: StoredHiringJob[]) {
  const fingerprint = fingerprintFor(company, candidates);
  const now = Date.now();
  const cached = await withCacheLock(async () => {
    const cache = await readCache();
    const entry = cache.entries[company.companyId];
    if (entry && entry.fingerprint === fingerprint && entry.expiresAt > now) return entry.result;
    return null;
  });
  if (cached) return cached;

  const result = await verifyGenericHiringJobs({
    companyName: company.name,
    companyDomain: company.domain,
    careerPageUrl: company.careerPageUrl,
    sourceUrl: company.sourceUrl,
    checkedAt: company.lastCheckedAt || new Date().toISOString(),
    candidates: candidates.map(asDiscovered),
    explicitEmpty: company.scanStatus === "success" && candidates.length === 0,
  });

  await withCacheLock(async () => {
    const cache = await readCache();
    const ttlHours = result.conclusive
      ? numberEnv("HIRING_VERIFICATION_CACHE_TTL_HOURS", DEFAULT_CACHE_TTL_HOURS, 1, 168)
      : numberEnv("HIRING_VERIFICATION_INCONCLUSIVE_TTL_HOURS", DEFAULT_INCONCLUSIVE_TTL_HOURS, 1, 24);
    cache.entries[company.companyId] = {
      fingerprint,
      createdAt: now,
      expiresAt: now + ttlHours * 60 * 60_000,
      result,
    };
    await writeCache(cache);
  });
  return result;
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, () => run()));
  return results;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withinDays(value: string, days: number, nowMs: number) {
  const parsed = timestamp(value);
  return parsed > 0 && parsed <= nowMs + 2 * DAY_MS && parsed >= nowMs - days * DAY_MS;
}

function rawMatch(company: HiringCompanySignal, job: DiscoveredJob) {
  const targetUrl = normalizedUrl(job.url);
  const targetId = clean(job.externalId, 500).toLowerCase();
  return activeRawJobs(company).find((candidate) => {
    if (targetUrl && normalizedUrl(candidate.url) === targetUrl) return true;
    return Boolean(targetId) && clean(candidate.externalId, 500).toLowerCase() === targetId;
  });
}

function observationDate(company: HiringCompanySignal, job: DiscoveredJob) {
  if (withinDays(job.postedAt, 3650, Date.now())) return job.postedAt;
  const match = rawMatch(company, job);
  if (!match?.firstSeenAt || company.snapshots.length < 2) return "";
  const baselineAt = timestamp(company.snapshots[0]?.checkedAt || "");
  const firstSeenAt = timestamp(match.firstSeenAt);
  if (!baselineAt || !firstSeenAt || firstSeenAt <= baselineAt + 60_000) return "";
  return match.firstSeenAt;
}

function topValues(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = clean(raw, 300);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function coverageFor(method: HiringVerificationMethod): VerificationCoverage {
  if (method === "openrouter-web") return "partial";
  if (method === "inconclusive") return "unknown";
  return "complete";
}

function toStoredJobs(company: HiringCompanySignal, jobs: DiscoveredJob[]): StoredHiringJob[] {
  const checkedAt = company.lastCheckedAt || new Date().toISOString();
  return jobs.map((job) => {
    const match = rawMatch(company, job);
    return {
      ...job,
      firstSeenAt: match?.firstSeenAt || "",
      lastSeenAt: match?.lastSeenAt || checkedAt,
      closedAt: "",
      status: "active" as const,
      missCount: 0,
    };
  });
}

function applyVerification(company: HiringCompanySignal, result: HiringVerificationResult): VerifiedHiringCompanySignal {
  const nowMs = Date.now();
  const jobs = result.conclusive || result.jobs.length ? result.jobs : [];
  const activeJobs = jobs.length;
  const newJobs7d = jobs.filter((job) => withinDays(observationDate(company, job), 7, nowMs)).length;
  const newJobs30d = jobs.filter((job) => withinDays(observationDate(company, job), 30, nowMs)).length;
  const topDepartments = topValues(jobs.map((job) => job.department));
  const topLocations = topValues(jobs.map((job) => job.location));
  const hiringScore = calculateHiringScore({
    activeJobs,
    newJobs7d,
    previousActiveJobs: activeJobs,
    hasHrJobs: jobs.some((job) => isHrOrRecruitingRole(job.title)),
    locationCount: new Set(jobs.map((job) => clean(job.location, 300)).filter(Boolean)).size,
  });
  const trend = activeJobs === 0
    ? "No active hiring" as const
    : newJobs7d >= 3
      ? "Growing" as const
      : "Stable" as const;

  return {
    ...company,
    rawActiveJobs: company.activeJobs,
    rawNewJobs7d: company.newJobs7d,
    rawNewJobs30d: company.newJobs30d,
    rawJobsDetected: result.rawCandidateCount,
    staleJobsExcluded: Math.max(result.rejectedStaleCount, result.rawCandidateCount - jobs.length),
    verificationMethod: result.method,
    verificationConfidence: result.confidence,
    verificationCoverage: coverageFor(result.method),
    verificationNote: result.note,
    webSearchVerified: result.webSearchUsed,
    activeJobs,
    previousActiveJobs: activeJobs,
    newJobs7d,
    newJobs30d,
    closedJobs7d: 0,
    hiringScore,
    hiringStatus: hiringStatus(hiringScore),
    trend,
    topDepartments,
    topLocations,
    scanStatus: result.conclusive ? "success" : "inconclusive",
    error: result.conclusive ? "" : result.note,
    jobs: toStoredJobs(company, jobs),
  };
}

function pendingVerification(company: HiringCompanySignal): VerifiedHiringCompanySignal {
  return applyVerification(company, {
    jobs: [],
    conclusive: false,
    method: "inconclusive",
    confidence: "low",
    rawCandidateCount: activeRawJobs(company).length,
    rejectedStaleCount: 0,
    webSearchUsed: false,
    note: "Verification is pending. Raw career-page candidates are deliberately not counted until current official evidence is confirmed.",
  });
}

function conservativeStore(raw: HiringStore): VerifiedHiringStore {
  return {
    ...raw,
    verificationGeneratedAt: "",
    companies: raw.companies.map(pendingVerification),
  };
}

async function buildVerifiedStore(raw: HiringStore): Promise<VerifiedHiringStore> {
  const concurrency = numberEnv("HIRING_VERIFICATION_CONCURRENCY", DEFAULT_CONCURRENCY, 1, 8);
  const companies = await mapConcurrent(raw.companies, concurrency, async (company) => {
    const candidates = activeRawJobs(company);
    const result = authoritativeLiveSource(company)
      ? authoritativeResult(candidates)
      : await cachedGenericVerification(company, candidates);
    return applyVerification(company, result);
  });

  companies.sort((a, b) => b.hiringScore - a.hiringScore || b.newJobs7d - a.newJobs7d || b.activeJobs - a.activeJobs || a.name.localeCompare(b.name));
  return {
    ...raw,
    verificationGeneratedAt: new Date().toISOString(),
    companies,
  };
}

export async function refreshVerifiedHiringStore() {
  if (verificationInFlight) return verificationInFlight;
  verificationInFlight = (async () => {
    const raw = await getHiringStore();
    const store = await buildVerifiedStore(raw);
    await persistVerifiedStore(raw.generatedAt, store);
    return store;
  })().finally(() => {
    verificationInFlight = null;
  });
  return verificationInFlight;
}

export async function getVerifiedHiringStore() {
  const raw = await getHiringStore();
  const persisted = await readPersistedVerifiedStore();
  const persistedAgeMs = persisted?.store.verificationGeneratedAt
    ? Date.now() - timestamp(persisted.store.verificationGeneratedAt)
    : Number.POSITIVE_INFINITY;
  const exactRawMatch = Boolean(persisted && persisted.rawGeneratedAt === raw.generatedAt);
  const acceptStaleVerified = Boolean(
    persisted
      && persistedAgeMs >= 0
      && persistedAgeMs <= MAX_STALE_VERIFIED_STORE_HOURS * 60 * 60_000,
  );

  if (!exactRawMatch) {
    void refreshVerifiedHiringStore().catch((error) => {
      console.error("Verified hiring refresh failed", error);
    });
  }

  if (exactRawMatch && persisted) return persisted.store;
  if (acceptStaleVerified && persisted) return persisted.store;
  return conservativeStore(raw);
}
