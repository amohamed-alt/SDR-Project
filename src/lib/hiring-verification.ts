import { openRouterCompletion } from "@/lib/openrouter-low-cost";
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

type AiJob = {
  id?: string;
  title?: string;
  url?: string;
  postedAt?: string;
};

type AiVerification = {
  status?: "verified" | "none" | "uncertain";
  jobs?: AiJob[];
  note?: string;
};

const DAY_MS = 86_400_000;
const FUTURE_DATE_GRACE_DAYS = 2;
const DEFAULT_MAX_AGE_DAYS = 120;
const MAX_AI_JOBS = 10;

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

function normalizedIsoDate(value: string) {
  const timestamp = validTimestamp(value);
  return timestamp ? new Date(timestamp).toISOString() : "";
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

function hostname(value: string) {
  const url = normalizeUrl(value);
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
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

function officialDomains(args: {
  companyDomain: string;
  careerPageUrl: string;
  sourceUrl: string;
  candidates: DiscoveredJob[];
}) {
  const values = [
    args.companyDomain.includes("://") ? args.companyDomain : args.companyDomain ? `https://${args.companyDomain}` : "",
    args.careerPageUrl,
    args.sourceUrl,
    ...args.candidates.slice(0, 30).map((job) => job.url),
  ];
  const domains = values.map(hostname).filter(Boolean);
  return [...new Set(domains)].slice(0, 8);
}

function parseAiVerification(raw: string): AiVerification | null {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(normalized) as AiVerification;
    if (!parsed || !["verified", "none", "uncertain"].includes(String(parsed.status))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function aiJobsToDiscovered(ai: AiVerification, candidates: DiscoveredJob[]) {
  const jobs: DiscoveredJob[] = [];
  for (const item of Array.isArray(ai.jobs) ? ai.jobs.slice(0, MAX_AI_JOBS) : []) {
    const title = clean(item.title, 300);
    const url = normalizeUrl(clean(item.url, 1_000));
    if (!title || !url) continue;
    const existing = candidates.find((candidate) => normalizeUrl(candidate.url) === url)
      || candidates.find((candidate) => clean(candidate.title, 300).toLowerCase() === title.toLowerCase());
    jobs.push({
      externalId: clean(item.id, 500) || existing?.externalId || url,
      title,
      location: existing?.location || "",
      department: existing?.department || "",
      url,
      postedAt: normalizedIsoDate(clean(item.postedAt, 100)) || existing?.postedAt || "",
    });
  }
  return uniqueJobs(jobs);
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

  const domains = officialDomains({
    companyDomain: args.companyDomain,
    careerPageUrl: args.careerPageUrl,
    sourceUrl: args.sourceUrl,
    candidates,
  });
  if (!domains.length) {
    return {
      jobs: fresh,
      conclusive: fresh.length > 0,
      method: fresh.length ? "structured-freshness" : "inconclusive",
      confidence: fresh.length ? "high" : "low",
      rawCandidateCount: candidates.length,
      rejectedStaleCount: stale.length,
      webSearchUsed: false,
      note: fresh.length
        ? "Fresh structured jobs were retained, but ambiguous postings could not be web-verified because no official domain was available."
        : "No official domain was available for conservative web verification.",
    };
  }

  const candidateEvidence = [...ambiguous, ...stale]
    .slice(0, 30)
    .map((job, index) => ({
      index,
      id: clean(job.externalId, 300),
      title: clean(job.title, 220),
      url: normalizeUrl(job.url),
      postedAt: clean(job.postedAt, 100),
      validThrough: validThrough(job),
      location: clean(job.location, 160),
    }));

  const system = [
    "You verify current job openings for Talentera SDR hiring intelligence.",
    "Precision is more important than recall: false positives are unacceptable.",
    "Use web search and rely only on official company career pages or official ATS pages within the allowed domains.",
    "Do not use LinkedIn, Indeed, Glassdoor, job aggregators, cached snippets, SEO result counts, or guessed totals as proof.",
    "A job is verified only if current official evidence shows the role is still open/applyable, or an official ATS listing is currently live.",
    "Exclude archive pages, expired roles, filled roles, closed applications, and old undated pages that cannot be proven current.",
    "Return ONLY valid compact JSON with status, jobs, note. status must be verified, none, or uncertain.",
    "jobs must contain only directly verified current roles and each job must have title and official url; include postedAt only when directly supported.",
    "Never estimate a total job count. If evidence is insufficient, use uncertain.",
  ].join(" ");

  const user = JSON.stringify({
    today: new Date(nowMs).toISOString().slice(0, 10),
    company: clean(args.companyName, 240),
    companyDomain: clean(args.companyDomain, 240),
    careerPageUrl: normalizeUrl(args.careerPageUrl),
    sourceUrl: normalizeUrl(args.sourceUrl),
    allowedOfficialDomains: domains,
    alreadyAcceptedFreshJobs: fresh.slice(0, 10).map((job) => ({ title: job.title, url: job.url, postedAt: job.postedAt })),
    ambiguousOrStaleCandidates: candidateEvidence,
    instruction: `Search the allowed official domains and return at most ${MAX_AI_JOBS} directly verified current jobs. If you cannot prove a role is current, omit it.`,
  });

  try {
    const completion = await openRouterCompletion({
      cacheKey: `hiring-web-verify:${clean(args.companyDomain || args.companyName, 240)}:${user}`,
      system,
      user,
      mode: "fast",
      maxOutputTokens: 220,
      temperature: 0,
      serverTools: [{
        type: "openrouter:web_search",
        parameters: {
          engine: "perplexity",
          max_results: 8,
          max_total_results: 8,
          max_uses: 1,
          max_characters: 2_500,
          allowed_domains: domains,
        },
      }],
      maxToolCalls: 1,
      forceServerTool: true,
      estimatedServerToolCostUsdPerUse: 0.005,
    });
    const parsed = parseAiVerification(completion.content);
    if (!parsed) throw new Error("Web verifier returned invalid JSON.");

    const verifiedFromWeb = parsed.status === "verified" ? aiJobsToDiscovered(parsed, candidates) : [];
    const jobs = uniqueJobs([...fresh, ...verifiedFromWeb]);
    if (parsed.status === "uncertain") {
      return {
        jobs: fresh,
        conclusive: fresh.length > 0,
        method: fresh.length ? "structured-freshness" : "inconclusive",
        confidence: fresh.length ? "high" : "low",
        rawCandidateCount: candidates.length,
        rejectedStaleCount: stale.length,
        webSearchUsed: true,
        note: clean(parsed.note, 500) || "Official web evidence was insufficient to verify ambiguous job postings.",
      };
    }

    return {
      jobs,
      conclusive: true,
      method: parsed.status === "verified" ? "openrouter-web" : fresh.length ? "structured-freshness" : "verified-empty",
      confidence: parsed.status === "verified" ? "medium" : fresh.length ? "high" : "medium",
      rawCandidateCount: candidates.length,
      rejectedStaleCount: stale.length,
      webSearchUsed: true,
      note: clean(parsed.note, 500) || (jobs.length ? `${jobs.length} current jobs verified from official web evidence.` : "No current jobs could be verified on official sources."),
    };
  } catch (error) {
    return {
      jobs: fresh,
      conclusive: fresh.length > 0,
      method: fresh.length ? "structured-freshness" : "inconclusive",
      confidence: fresh.length ? "high" : "low",
      rawCandidateCount: candidates.length,
      rejectedStaleCount: stale.length,
      webSearchUsed: false,
      note: fresh.length
        ? `Fresh structured jobs retained; web verification unavailable: ${error instanceof Error ? error.message : "unknown error"}`
        : `No job was counted because web verification was unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
