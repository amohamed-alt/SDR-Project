export type HiringSourceKind = "greenhouse" | "lever" | "smartrecruiters" | "generic";
export type HiringSignalStatus = "No Signal" | "Hiring" | "Active Hiring" | "Strong Hiring" | "Hiring Surge";
export type HiringTrend = "New hiring" | "Surging" | "Growing" | "Stable" | "Cooling" | "No active hiring";

export interface DiscoveredJob {
  externalId: string;
  title: string;
  location: string;
  department: string;
  url: string;
  postedAt: string;
}

export interface HiringSource {
  kind: HiringSourceKind;
  key: string;
  url: string;
  confidence: "high" | "medium" | "low";
}

export interface StoredHiringJob extends DiscoveredJob {
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt: string;
  status: "active" | "closed";
  missCount: number;
}

export interface HiringScoreInput {
  activeJobs: number;
  newJobs7d: number;
  previousActiveJobs: number;
  hasHrJobs: boolean;
  locationCount: number;
}

const KSA_ALIASES = new Set(["sa", "sau", "ksa", "saudi arabia", "kingdom of saudi arabia", "السعودية", "المملكة العربية السعودية"]);
const UAE_ALIASES = new Set(["ae", "are", "uae", "united arab emirates", "the united arab emirates", "الإمارات", "الإمارات العربية المتحدة"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function stableId(job: Pick<DiscoveredJob, "externalId" | "url" | "title" | "location">) {
  if (job.externalId) return job.externalId;
  if (job.url) return job.url.toLowerCase();
  return `${job.title}|${job.location}`.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueJobs(jobs: DiscoveredJob[]) {
  const result = new Map<string, DiscoveredJob>();
  for (const job of jobs) {
    const title = clean(job.title);
    if (!title) continue;
    const normalized = { ...job, title, externalId: stableId(job) };
    const key = stableId(normalized);
    if (!result.has(key)) result.set(key, normalized);
  }
  return [...result.values()];
}

export function normalizeTargetCountry(value: string) {
  const normalized = clean(value).toLowerCase().replace(/[.,]/g, "");
  if (KSA_ALIASES.has(normalized) || /\bsaudi\b/.test(normalized)) return "Saudi Arabia";
  if (UAE_ALIASES.has(normalized) || /\bunited arab emirates\b|\buae\b/.test(normalized)) return "United Arab Emirates";
  return "";
}

function findFirstUrl(candidates: string[], patterns: RegExp[]) {
  for (const candidate of candidates.filter(Boolean)) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (match?.[1]) return { candidate, key: decodeURIComponent(match[1]) };
    }
  }
  return null;
}

export function detectHiringSource(careerPageUrl: string, ats: string, evidenceUrl = ""): HiringSource {
  const candidates = [careerPageUrl, evidenceUrl];
  const greenhouse = findFirstUrl(candidates, [
    /(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/i,
    /boards-api\.greenhouse\.io\/v1\/boards\/([^/?#]+)/i,
  ]);
  if (greenhouse) return { kind: "greenhouse", key: greenhouse.key, url: greenhouse.candidate, confidence: "high" };

  const lever = findFirstUrl(candidates, [
    /jobs(?:\.eu)?\.lever\.co\/([^/?#]+)/i,
    /api(?:\.eu)?\.lever\.co\/v0\/postings\/([^/?#]+)/i,
  ]);
  if (lever) return { kind: "lever", key: lever.key, url: lever.candidate, confidence: "high" };

  const smartRecruiters = findFirstUrl(candidates, [
    /(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)/i,
    /api\.smartrecruiters\.com\/v1\/companies\/([^/?#]+)\/postings/i,
  ]);
  if (smartRecruiters) return { kind: "smartrecruiters", key: smartRecruiters.key, url: smartRecruiters.candidate, confidence: "high" };

  const atsName = clean(ats).toLowerCase();
  if (atsName.includes("greenhouse") || atsName.includes("lever") || atsName.includes("smartrecruiters")) {
    return { kind: "generic", key: "", url: careerPageUrl || evidenceUrl, confidence: "medium" };
  }
  return { kind: "generic", key: "", url: careerPageUrl || evidenceUrl, confidence: "low" };
}

function collectJsonObjects(value: unknown, target: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const child of value) collectJsonObjects(child, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  const types = Array.isArray(type) ? type.map(clean) : [clean(type)];
  if (types.some((item) => item.toLowerCase() === "jobposting")) target.push(object);
  for (const child of Object.values(object)) collectJsonObjects(child, target);
}

function locationFromJobPosting(value: unknown) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const locations: string[] = [];
  for (const entry of values) {
    if (typeof entry === "string") {
      if (clean(entry)) locations.push(clean(entry));
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const object = entry as Record<string, unknown>;
    const address = object.address;
    if (typeof address === "string") {
      if (clean(address)) locations.push(clean(address));
      continue;
    }
    if (!address || typeof address !== "object") continue;
    const parts = ["addressLocality", "addressRegion", "addressCountry"]
      .map((key) => clean((address as Record<string, unknown>)[key]))
      .filter(Boolean);
    if (parts.length) locations.push(parts.join(", "));
  }
  return [...new Set(locations)].join(" · ");
}

function identifierFromJobPosting(value: unknown) {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  return clean(object.value) || clean(object.name);
}

export function parseJobPostingJsonLd(html: string, baseUrl: string): DiscoveredJob[] {
  const objects: Record<string, unknown>[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeHtml(match[1]?.trim() ?? "");
    if (!raw) continue;
    try {
      collectJsonObjects(JSON.parse(raw), objects);
    } catch {
      // Invalid JSON-LD should not prevent other structured job blocks from being parsed.
    }
  }

  return uniqueJobs(objects.map((object) => {
    const url = absoluteUrl(clean(object.url), baseUrl);
    const title = stripTags(clean(object.title) || clean(object.name));
    const externalId = identifierFromJobPosting(object.identifier) || url;
    return {
      externalId,
      title,
      location: locationFromJobPosting(object.jobLocation) || clean(object.jobLocationType),
      department: clean(object.occupationalCategory),
      url,
      postedAt: clean(object.datePosted),
    };
  }));
}

const GENERIC_LINK_TEXT = new Set(["jobs", "job", "careers", "career", "view jobs", "view job", "apply", "apply now", "learn more", "details"]);

export function parseJobLinks(html: string, baseUrl: string): DiscoveredJob[] {
  const jobs: DiscoveredJob[] = [];
  const anchorPattern = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[2] ?? "");
    const text = stripTags(match[4] ?? "");
    if (!href || !text || text.length < 4 || text.length > 180) continue;
    if (GENERIC_LINK_TEXT.has(text.toLowerCase())) continue;
    if (!/(?:\/|\b)(job|jobs|career|careers|vacan|position|opening|requisition|posting)[a-z0-9_-]*(?:\/|\b|\?|#)/i.test(href)) continue;
    const url = absoluteUrl(href, baseUrl);
    if (!url || /(?:login|signin|privacy|terms|talent-community|job-alert)/i.test(url)) continue;
    jobs.push({ externalId: url, title: text, location: "", department: "", url, postedAt: "" });
    if (jobs.length >= 250) break;
  }
  return uniqueJobs(jobs);
}

export function mergeStoredJobs(previous: StoredHiringJob[], discovered: DiscoveredJob[], checkedAt: string) {
  const previousById = new Map(previous.map((job) => [stableId(job), job]));
  const discoveredById = new Map(discovered.map((job) => [stableId(job), job]));
  const merged: StoredHiringJob[] = [];

  for (const [id, job] of discoveredById) {
    const existing = previousById.get(id);
    merged.push({
      ...job,
      externalId: id,
      firstSeenAt: existing?.firstSeenAt || checkedAt,
      lastSeenAt: checkedAt,
      closedAt: "",
      status: "active",
      missCount: 0,
    });
  }

  for (const [id, job] of previousById) {
    if (discoveredById.has(id)) continue;
    const missCount = job.status === "active" ? job.missCount + 1 : job.missCount;
    const shouldClose = job.status === "closed" || missCount >= 2;
    merged.push({
      ...job,
      externalId: id,
      missCount,
      status: shouldClose ? "closed" : "active",
      closedAt: shouldClose ? (job.closedAt || checkedAt) : "",
    });
  }

  return merged.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return (b.postedAt || b.firstSeenAt).localeCompare(a.postedAt || a.firstSeenAt);
  });
}

export function calculateHiringScore(input: HiringScoreInput) {
  let score = 0;
  if (input.activeJobs >= 11) score += 40;
  else if (input.activeJobs >= 6) score += 30;
  else if (input.activeJobs >= 3) score += 20;
  else if (input.activeJobs >= 1) score += 10;

  if (input.newJobs7d >= 10) score += 25;
  else if (input.newJobs7d >= 5) score += 20;
  else if (input.newJobs7d >= 2) score += 10;
  else if (input.newJobs7d >= 1) score += 5;

  if (input.previousActiveJobs === 0 && input.activeJobs > 0) score += 15;
  else if (input.previousActiveJobs > 0) {
    const growth = (input.activeJobs - input.previousActiveJobs) / input.previousActiveJobs;
    if (growth >= 0.5) score += 15;
    else if (growth >= 0.2) score += 10;
    else if (growth > 0) score += 5;
  }

  if (input.locationCount >= 2) score += 5;
  if (input.hasHrJobs) score += 5;
  if (input.newJobs7d > 0) score += 10;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function hiringStatus(score: number): HiringSignalStatus {
  if (score >= 80) return "Hiring Surge";
  if (score >= 60) return "Strong Hiring";
  if (score >= 40) return "Active Hiring";
  if (score >= 20) return "Hiring";
  return "No Signal";
}

export function hiringTrend(activeJobs: number, previousActiveJobs: number): HiringTrend {
  if (activeJobs === 0) return "No active hiring";
  if (previousActiveJobs === 0) return "New hiring";
  const growth = (activeJobs - previousActiveJobs) / previousActiveJobs;
  if (growth >= 0.3) return "Surging";
  if (growth > 0.05) return "Growing";
  if (growth <= -0.3) return "Cooling";
  return "Stable";
}

export function isHrOrRecruitingRole(title: string) {
  return /\b(recruit|talent acquisition|human resources|\bhr\b|people operations|people partner)\b/i.test(title);
}
