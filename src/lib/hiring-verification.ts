import type { DiscoveredJob } from "@/lib/hiring-signals-core";

export type HiringVerificationMethod =
  | "authoritative-ats"
  | "structured-freshness"
  | "openrouter-web"
  | "verified-empty"
  | "inconclusive";

export type HiringVerificationResult = {
  jobs: DiscoveredJob[];
  conclusive: boolean;
  method: HiringVerificationMethod;
  confidence: "high" | "medium" | "low";
  rawCandidateCount: number;
  rejectedStaleCount: number;
  webSearchUsed: boolean;
  note: string;
};

type CandidateJob = DiscoveredJob & { validThrough?: string };

const DAY_MS = 86_400_000;
const FUTURE_DATE_GRACE_DAYS = 2;
const DEFAULT_MAX_AGE_DAYS = 120;

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clean(value: unknown, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function validTimestamp(value: string) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeUrl(value: string) {
  const raw = clean(value, 1_000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function validThrough(job: DiscoveredJob) {
  return clean((job as CandidateJob).validThrough, 100);
}

function sameJob(a: DiscoveredJob, b: DiscoveredJob) {
  const aUrl = normalizeUrl(a.url);
  const bUrl = normalizeUrl(b.url);
  if (aUrl && bUrl && aUrl === bUrl) return true;
  const aId = clean(a.externalId, 500).toLowerCase();
  const bId = clean(b.externalId, 500).toLowerCase();
  if (aId && bId && aId === bId) return true;
  return clean(a.title, 300).toLowerCase() === clean(b.title, 300).toLowerCase()
    && clean(a.location, 300).toLowerCase() === clean(b.location, 300).toLowerCase();
}

function uniqueJobs(jobs: DiscoveredJob[]) {
  const result: DiscoveredJob[] = [];
  for (const job of jobs) {
    if (!clean(job.title) || result.some((existing) => sameJob(existing, job))) continue;
    result.push(job);
  }
  return result;
}

function deterministicFreshness(job: DiscoveredJob, nowMs: number, maxAgeDays: number) {
  const postedAt = validTimestamp(job.postedAt);
  const expiresAt = validTimestamp(validThrough(job));

  if (expiresAt && expiresAt < nowMs) return "stale" as const;
  if (expiresAt && expiresAt >= nowMs) return "fresh" as const;
  if (!postedAt) return "ambiguous" as const;
  if (postedAt > nowMs + FUTURE_DATE_GRACE_DAYS * DAY_MS) return "ambiguous" as const;
  if (postedAt < nowMs - maxAgeDays * DAY_MS) return "stale" as const;
  return "fresh" as const;
}

export async function verifyGenericHiringJobs(args: {
  companyName: string;
  companyDomain: string;
  careerPageUrl: string;
  sourceUrl: string;
  checkedAt: string;
  candidates: DiscoveredJob[];
  explicitEmpty?: boolean;
}): Promise<HiringVerificationResult> {
  const nowMs = validTimestamp(args.checkedAt) || Date.now();
  const maxAgeDays = numberEnv("HIRING_GENERIC_MAX_POSTING_AGE_DAYS", DEFAULT_MAX_AGE_DAYS, 14, 365);
  const candidates = uniqueJobs(args.candidates);
  const fresh: DiscoveredJob[] = [];
  const ambiguous: DiscoveredJob[] = [];
  const stale: DiscoveredJob[] = [];

  for (const job of candidates) {
    const state = deterministicFreshness(job, nowMs, maxAgeDays);
    if (state === "fresh") fresh.push(job);
    else if (state === "stale") stale.push(job);
    else ambiguous.push(job);
  }

  if (args.explicitEmpty && !fresh.length && !ambiguous.length) {
    return {
      jobs: [],
      conclusive: true,
      method: "verified-empty",
      confidence: "high",
      rawCandidateCount: candidates.length,
      rejectedStaleCount: stale.length,
      webSearchUsed: false,
      note: "The official career source explicitly reports no current openings.",
    };
  }

  const shouldSearch = ambiguous.length > 0 || (fresh.length === 0 && (stale.length > 0 || candidates.length === 0));
  if (!shouldSearch) {
    return {
      jobs: fresh,
      conclusive: true,
      method: "structured-freshness",
      confidence: "high",
      rawCandidateCount: candidates.length,
      rejectedStaleCount: stale.length,
      webSearchUsed: false,
      note: `${fresh.length} current job${fresh.length === 1 ? "" : "s"} verified from structured posting dates; ${stale.length} stale posting${stale.length === 1 ? "" : "s"} excluded.`,
    };
  }

  return {
    jobs: fresh,
    conclusive: fresh.length > 0,
    method: fresh.length ? "structured-freshness" : "inconclusive",
    confidence: fresh.length ? "high" : "low",
    rawCandidateCount: candidates.length,
    rejectedStaleCount: stale.length,
    webSearchUsed: false,
    note: "Live generic web verification is unavailable. Only fresh structured official postings are counted; ambiguous and stale roles are excluded.",
  };
}
