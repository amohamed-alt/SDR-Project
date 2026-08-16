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
const INTERNAL_ROOT_DOMAINS = ["talentera.com", "bayt.com", "bayt.net"];
const INTERNAL_EXACT_NAMES = new Set(["talentera", "bayt", "bayt.com"]);

const ATS_VENDOR_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "oracle", pattern: /\b(?:oracle(?: hcm(?: cloud)?| recruiting(?: cloud)?| cloud| hrms| irecruitment| netsuite)?|taleo)\b/ },
  { key: "successfactors", pattern: /\b(?:sap )?(?:successfactors|e-recruiting)\b/ },
  { key: "workday", pattern: /\bworkday\b/ },
  { key: "workable", pattern: /\bworkable\b/ },
  { key: "zoho-recruit", pattern: /\bzoho recruit\b/ },
  { key: "teamtailor", pattern: /\bteamtailor\b/ },
  { key: "elevatus", pattern: /\belevatus\b/ },
  { key: "menaitech", pattern: /\bmenaitech\b/ },
  { key: "phenom", pattern: /\bphenom(?: people)?\b/ },
  { key: "icims", pattern: /\bicims(?: \(jibe\))?\b/ },
  { key: "manatal", pattern: /\bmanatal\b/ },
  { key: "recruitee", pattern: /\brecruitee\b/ },
  { key: "avature", pattern: /\bavature\b/ },
  { key: "darwinbox", pattern: /\bdarwinbox\b/ },
  { key: "jazzhr", pattern: /\bjazzhr\b/ },
  { key: "sniperhire", pattern: /\b(?:sniperhire|cazar(?: sniperhire)?)\b/ },
  { key: "zenats", pattern: /\bzenats\b/ },
  { key: "hyrdd", pattern: /\bhyrdd\b/ },
  { key: "jisr", pattern: /\bjisr\b/ },
  { key: "jobsoid", pattern: /\bjobsoid\b/ },
  { key: "odoo", pattern: /\bodoo(?: recruitment)?\b/ },
  { key: "eightfold", pattern: /\beightfold(?: ai)?\b/ },
  { key: "kayanhr", pattern: /\bkayanhr\b/ },
  { key: "akhtaboot", pattern: /\bakhtaboot\b/ },
  { key: "bamboohr", pattern: /\bbamboohr\b/ },
  { key: "fasthire", pattern: /\bfasthire\b/ },
  { key: "freshteam", pattern: /\bfreshteam\b/ },
  { key: "jobvite", pattern: /\bjobvite\b/ },
  { key: "pageup", pattern: /\bpageup\b/ },
  { key: "people365", pattern: /\bpeople365\b/ },
  { key: "peoplestrong", pattern: /\bpeoplestrong\b/ },
  { key: "adrenalin", pattern: /\badrenalin\b/ },
  { key: "attract", pattern: /\battract ats\b/ },
  { key: "breezy", pattern: /\bbreezy hr\b/ },
  { key: "fountain", pattern: /\bfountain\b/ },
  { key: "ukg", pattern: /\bukg(?: pro)? recruiting(?: \(ultipro\))?\b/ },
  { key: "webhr", pattern: /\bwebhr\b/ },
  { key: "whitecarrot", pattern: /\bwhitecarrot\b/ },
  { key: "applicantstack", pattern: /\bapplicantstack\b/ },
  { key: "ashby", pattern: /\bashby\b/ },
  { key: "bayzat", pattern: /\bbayzat ats\b/ },
  { key: "beisen", pattern: /\bbeisen(?: \(zhiye\))?\b/ },
  { key: "bizneo", pattern: /\bbizneo\b/ },
  { key: "cegid", pattern: /\bcegid(?: hr| talentsoft)?\b|\btalentsoft\b/ },
  { key: "civilsoft", pattern: /\bcivilsoft\b/ },
  { key: "comeet", pattern: /\bcomeet\b/ },
  { key: "cornerstone", pattern: /\bcornerstone(?: ondemand)?\b/ },
  { key: "dover", pattern: /\bdover\b/ },
  { key: "epreselec", pattern: /\bepreselec(?: \(infojobs\))?\b/ },
  { key: "erpnext", pattern: /\b(?:erpnext|frappe hrms(?: \/ erpnext)?)\b/ },
  { key: "haley", pattern: /\bhaley marketing\b/ },
  { key: "huntflow", pattern: /\bhuntflow\b/ },
  { key: "iapplicants", pattern: /\biapplicants\b/ },
  { key: "join", pattern: /^join$/ },
  { key: "kula", pattern: /^kula$/ },
  { key: "oneinfinity", pattern: /\boneinfinity\b/ },
  { key: "pyjamahr", pattern: /\bpyjamahr\b/ },
  { key: "radancy", pattern: /\bradancy\b/ },
  { key: "reachme", pattern: /\breachme\b/ },
  { key: "ripplehire", pattern: /\bripplehire\b/ },
  { key: "sage-people", pattern: /\bsage people(?: recruit)?\b/ },
  { key: "talentlyft", pattern: /\btalentlyft\b/ },
  { key: "tamm", pattern: /^tamm$/ },
  { key: "trakstar", pattern: /\btrakstar hire\b/ },
  { key: "tribepad", pattern: /\btribepad\b/ },
  { key: "uniteamrecruit", pattern: /\buniteamrecruit\b/ },
  { key: "yello", pattern: /^yello$/ },
  { key: "jadarat", pattern: /\bjadarat\b/ },
  { key: "dubai-careers", pattern: /\bdubai careers(?: government portal)?\b/ },
  { key: "takafo", pattern: /\btakafo\+?\b/ },
  { key: "wuzzuf", pattern: /\bwuzzuf\b/ },
  { key: "mihnati", pattern: /\bmihnati\b/ },
  { key: "talentera", pattern: /^talentera$/ },
  { key: "bayt", pattern: /^bayt(?:\.com)?(?: career portal)?$/ },
  { key: "greenhouse", pattern: /\bgreenhouse\b/ },
  { key: "lever", pattern: /^lever$/ },
  { key: "smartrecruiters", pattern: /\bsmartrecruiters(?: attrax)?\b/ },
];

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

function normalizedHostname(value: string) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").replace(/\.$/, "");
  }
}

export function shouldExcludeHiringCompany(input: { name?: string; domain?: string; accountType?: string }) {
  if (clean(input.accountType).toLowerCase() === "retention") return true;
  const domain = normalizedHostname(input.domain ?? "");
  if (INTERNAL_ROOT_DOMAINS.some((root) => domain === root || domain.endsWith(`.${root}`))) return true;
  return INTERNAL_EXACT_NAMES.has(clean(input.name).toLowerCase());
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

function findHostKey(candidates: string[], hostnamePattern: RegExp) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const parsed = new URL(candidate);
      const match = parsed.hostname.match(hostnamePattern);
      if (match?.[1]) return { candidate, key: decodeURIComponent(match[1]) };
    } catch {
      // Ignore malformed evidence URLs and continue with the remaining candidates.
    }
  }
  return null;
}

function findWorkday(candidates: string[]) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const parsed = new URL(candidate);
      if (!/\.myworkdayjobs\.com$/i.test(parsed.hostname)) continue;
      const cxs = parsed.pathname.match(/\/wday\/cxs\/([^/]+)\/([^/]+)\/jobs/i);
      if (cxs?.[1] && cxs?.[2]) return { candidate, key: `${decodeURIComponent(cxs[1])}|${decodeURIComponent(cxs[2])}` };
      const tenant = parsed.hostname.split(".")[0];
      const segments = parsed.pathname.split("/").filter(Boolean).filter((segment) => !/^[a-z]{2}[-_][a-z]{2}$/i.test(segment));
      const site = segments[0] ?? "";
      if (tenant && site) return { candidate, key: `${tenant}|${decodeURIComponent(site)}` };
      if (tenant) return { candidate, key: tenant };
    } catch {
      // Ignore malformed evidence URLs.
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

  const ashby = findFirstUrl(candidates, [
    /jobs\.ashbyhq\.com\/([^/?#]+)/i,
    /api\.ashbyhq\.com\/posting-api\/job-board\/([^/?#]+)/i,
  ]);
  if (ashby) return { kind: "generic", key: `ashby:${ashby.key}`, url: ashby.candidate, confidence: "high" };

  const recruitee = findHostKey(candidates, /^([^.]+)\.recruitee\.com$/i);
  if (recruitee) return { kind: "generic", key: `recruitee:${recruitee.key}`, url: recruitee.candidate, confidence: "high" };

  const workablePath = findFirstUrl(candidates, [/apply\.workable\.com\/([^/?#]+)/i]);
  if (workablePath) return { kind: "generic", key: `workable:${workablePath.key}`, url: workablePath.candidate, confidence: "high" };
  const workableHost = findHostKey(candidates, /^([^.]+)\.workable\.com$/i);
  if (workableHost && !["www", "apply", "jobs"].includes(workableHost.key.toLowerCase())) {
    return { kind: "generic", key: `workable:${workableHost.key}`, url: workableHost.candidate, confidence: "high" };
  }

  const workday = findWorkday(candidates);
  if (workday) return { kind: "generic", key: `workday:${workday.key}`, url: workday.candidate, confidence: "high" };

  const atsName = clean(ats).toLowerCase();
  const family = ATS_VENDOR_PATTERNS.find((entry) => entry.pattern.test(atsName));
  if (family) return { kind: "generic", key: `vendor:${family.key}`, url: careerPageUrl || evidenceUrl, confidence: "medium" };
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
