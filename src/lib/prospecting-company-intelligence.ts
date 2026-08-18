import { getHiringStore } from "@/lib/hiring-signals";
import {
  calculateHiringScore,
  detectHiringSource,
  hiringStatus,
  isHrOrRecruitingRole,
  parseJobLinks,
  parseJobPostingJsonLd,
} from "@/lib/hiring-signals-core";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
]);

const GENERIC_COMPANY_WORDS = new Set([
  "company", "co", "llc", "ltd", "limited", "inc", "corporation", "corp", "plc",
  "saudi", "arabia", "ksa", "kingdom", "of", "the", "and",
]);
const OPTIONAL_BRAND_WORDS = new Set(["group", "holding", "holdings"]);
const DIRECT_APPLICATION_LABEL = "Direct Application Form";

export interface ProspectHiringInsight {
  status: "Hiring Now" | "Accepting Applications" | "No Active Jobs" | "Unknown";
  activeJobs: number;
  hiringScore: number;
  hiringLabel: string;
  hasHrJobs: boolean;
  source: string;
  sourceUrl: string;
  checkedAt: string;
  jobsSample: Array<{ title: string; location: string; url: string }>;
}

export interface ProspectCompanyIntelligence {
  domain: string;
  website: string;
  careerPageUrl: string;
  detectedAts: string;
  atsConfidence: string;
  careerConfidence: number;
  evidenceUrl: string;
  verificationReason: string;
  hiring: ProspectHiringInsight;
}

type CareerEngineResult = {
  career_status?: string;
  career_url?: string;
  career_confidence_score?: number;
  career_evidence_reason?: string;
  career_evidence_url?: string;
  detected_ats?: string;
  ats_confidence?: string;
  ats_evidence_url?: string;
  ats_evidence_reason?: string;
};

type CareerEngineResponse = {
  ok?: boolean;
  result?: CareerEngineResult;
  error?: string;
};

type WebsiteResolution = {
  website: string;
  domain: string;
  reason: string;
};

export function normalizeCompanyDomain(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return input.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

export function resolveCompanyDomain(website: string, emails: string[]) {
  const fromWebsite = normalizeCompanyDomain(website);
  if (fromWebsite) return fromWebsite;
  for (const email of emails) {
    const domain = String(email || "").toLowerCase().split("@")[1] || "";
    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) return normalizeCompanyDomain(domain);
  }
  return "";
}

function normalizeWebsite(website: string, domain: string) {
  const input = String(website || "").trim();
  if (input && input.toLowerCase() !== "n/a") return /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return domain ? `https://${domain}` : "";
}

function emptyHiring(): ProspectHiringInsight {
  return {
    status: "Unknown",
    activeJobs: 0,
    hiringScore: 0,
    hiringLabel: "No Signal",
    hasHrJobs: false,
    source: "",
    sourceUrl: "",
    checkedAt: new Date().toISOString(),
    jobsSample: [],
  };
}

function uniqueJobs<T extends { url?: string; title?: string }>(jobs: T[]) {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${String(job.url || "").toLowerCase()}|${String(job.title || "").toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchCareerHtml(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TalenteraGTM/2.1; +https://talentera.com)" },
    signal: AbortSignal.timeout(22_000),
  });
  if (!response.ok) throw new Error(`Career page returned HTTP ${response.status}`);
  const text = (await response.text()).slice(0, 3_000_000);
  return { text, finalUrl: response.url || url };
}

function hasDirectApplicationForm(html: string) {
  return /<input[^>]+type\s*=\s*["']?file|job application form|apply for a job|submit (?:your )?(?:cv|resume)|upload (?:your )?(?:cv|resume)|attach (?:your )?(?:cv|resume)|نموذج طلب التوظيف|طلب التوظيف|تحميل السيرة الذاتية|رفع السيرة الذاتية|أرسل سيرتك|ارسل سيرتك/i.test(html);
}

function latinCompanyWords(companyName: string) {
  return companyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !GENERIC_COMPANY_WORDS.has(word));
}

function companyNameVariants(companyName: string) {
  const words = latinCompanyWords(companyName);
  if (!words.length) return [] as string[];
  const core = words.filter((word) => !OPTIONAL_BRAND_WORDS.has(word));
  const variants = new Set<string>();
  const add = (parts: string[]) => {
    const safe = parts.filter(Boolean);
    if (!safe.length) return;
    variants.add(safe.join(""));
    if (safe.length > 1) variants.add(safe.join("-"));
  };

  add(words);
  add(core);
  const first = core[0] || words[0];
  if (first?.startsWith("al") && first.length >= 5) {
    const noAl = first.slice(2);
    add([noAl, ...core.slice(1)]);
    if (words.some((word) => word === "group")) add([noAl, "group"]);
  }
  if (core.length === 1 && words.some((word) => word === "group")) add([core[0], "group"]);
  return [...variants].filter((value) => value.length >= 4).slice(0, 8);
}

export function candidateCompanyDomains(companyName: string, originalDomain = "") {
  const original = normalizeCompanyDomain(originalDomain);
  const candidates = new Set<string>();
  for (const stem of companyNameVariants(companyName)) {
    for (const tld of [".com", ".sa", ".com.sa"]) {
      const value = `${stem}${tld}`;
      if (value !== original) candidates.add(value);
    }
  }
  return [...candidates].slice(0, 18);
}

function compactLatin(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function brandVerificationScore(html: string, finalUrl: string, companyName: string, originalDomain: string) {
  const raw = html.toLowerCase();
  const compact = compactLatin(html.slice(0, 1_500_000));
  const words = latinCompanyWords(companyName);
  const core = words.filter((word) => !OPTIONAL_BRAND_WORDS.has(word));
  const fullCompact = words.join("");
  const coreCompact = core.join("");
  let score = 0;

  if (fullCompact.length >= 5 && compact.includes(fullCompact)) score += 60;
  if (coreCompact.length >= 5 && compact.includes(coreCompact)) score += 35;
  const oldDomain = normalizeCompanyDomain(originalDomain);
  if (oldDomain && raw.includes(oldDomain)) score += 30;
  const oldStem = oldDomain.split(".")[0];
  if (oldStem.length >= 5 && compact.includes(oldStem)) score += 10;
  if (/career|careers|jobs|join us|join our team|وظائف|التوظيف|انضم/i.test(raw)) score += 5;

  const finalDomain = normalizeCompanyDomain(finalUrl);
  if (candidateCompanyDomains(companyName, oldDomain).includes(finalDomain)) score += 10;
  return score;
}

async function probeBrandWebsite(domainCandidate: string, companyName: string, originalDomain: string): Promise<WebsiteResolution | null> {
  for (const protocol of ["https", "http"] as const) {
    const url = `${protocol}://${domainCandidate}/`;
    try {
      const response = await fetch(url, {
        redirect: "follow",
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TalenteraGTM/2.1; +https://talentera.com)" },
        signal: AbortSignal.timeout(7_000),
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (!/html|text/i.test(contentType)) continue;
      const html = (await response.text()).slice(0, 1_500_000);
      const finalUrl = response.url || url;
      if (brandVerificationScore(html, finalUrl, companyName, originalDomain) < 70) continue;
      const finalDomain = normalizeCompanyDomain(finalUrl);
      const final = new URL(finalUrl);
      return {
        website: `${final.protocol}//${final.host}/`,
        domain: finalDomain || domainCandidate,
        reason: `Verified a current company website from the company name after the supplied domain was inconclusive: ${originalDomain || "unknown"} → ${finalDomain || domainCandidate}.`,
      };
    } catch {
      // Try the next protocol/domain candidate.
    }
  }
  return null;
}

async function resolveAlternateCompanyWebsite(companyName: string, originalDomain: string) {
  const candidates = candidateCompanyDomains(companyName, originalDomain);
  if (!candidates.length) return null;
  let cursor = 0;
  let resolved: WebsiteResolution | null = null;
  async function worker() {
    while (!resolved) {
      const index = cursor++;
      if (index >= candidates.length) return;
      const match = await probeBrandWebsite(candidates[index], companyName, originalDomain);
      if (match && !resolved) resolved = match;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker()));
  return resolved;
}

async function hiringFromExistingStore(domains: string[]) {
  const normalized = [...new Set(domains.map(normalizeCompanyDomain).filter(Boolean))];
  if (!normalized.length) return null;
  try {
    const store = await getHiringStore();
    const match = store.companies.find((company) => normalized.includes(normalizeCompanyDomain(company.domain)));
    if (!match || !match.lastCheckedAt) return null;
    return {
      status: match.activeJobs > 0 ? "Hiring Now" as const : match.scanStatus === "success" ? "No Active Jobs" as const : "Unknown" as const,
      activeJobs: match.activeJobs,
      hiringScore: match.hiringScore,
      hiringLabel: match.hiringStatus,
      hasHrJobs: match.jobs.some((job) => job.status === "active" && isHrOrRecruitingRole(job.title)),
      source: "Hiring Intelligence",
      sourceUrl: match.sourceUrl || match.careerPageUrl,
      checkedAt: match.lastCheckedAt,
      jobsSample: match.jobs
        .filter((job) => job.status === "active")
        .slice(0, 5)
        .map((job) => ({ title: job.title, location: job.location, url: job.url })),
    } satisfies ProspectHiringInsight;
  } catch {
    return null;
  }
}

async function liveHiringScan(careerPageUrl: string, detectedAts: string): Promise<ProspectHiringInsight> {
  if (!careerPageUrl) return emptyHiring();
  const checkedAt = new Date().toISOString();
  try {
    const source = detectHiringSource(careerPageUrl, detectedAts, careerPageUrl);
    const page = await fetchCareerHtml(source.url || careerPageUrl);
    const structured = parseJobPostingJsonLd(page.text, page.finalUrl);
    const links = parseJobLinks(page.text, page.finalUrl);
    const jobs = uniqueJobs(structured.length ? structured : links);
    const explicitEmpty = /(?:no|without)\s+(?:current\s+)?(?:openings|vacancies|positions|jobs)|(?:currently|presently)\s+(?:have|has|with)\s+no\s+(?:openings|vacancies|positions|jobs)/i.test(page.text);
    const directApplication = hasDirectApplicationForm(page.text);
    const activeJobs = jobs.length;
    const hasHrJobs = jobs.some((job) => isHrOrRecruitingRole(job.title));
    const score = calculateHiringScore({
      activeJobs,
      newJobs7d: 0,
      previousActiveJobs: 0,
      hasHrJobs,
      locationCount: new Set(jobs.map((job) => String(job.location || "").trim()).filter(Boolean)).size,
    });
    const status: ProspectHiringInsight["status"] = activeJobs > 0
      ? "Hiring Now"
      : explicitEmpty
        ? "No Active Jobs"
        : directApplication
          ? "Accepting Applications"
          : "Unknown";
    return {
      status,
      activeJobs,
      hiringScore: status === "Accepting Applications" ? Math.max(score, 20) : score,
      hiringLabel: status === "Accepting Applications" ? "Applications Open" : hiringStatus(score),
      hasHrJobs,
      source: structured.length
        ? "Live structured jobs"
        : links.length
          ? "Live career links"
          : directApplication
            ? "Direct career application form"
            : "Live career check",
      sourceUrl: page.finalUrl,
      checkedAt,
      jobsSample: jobs.slice(0, 5).map((job) => ({
        title: String(job.title || "Open role"),
        location: String(job.location || ""),
        url: String(job.url || page.finalUrl),
      })),
    };
  } catch {
    return { ...emptyHiring(), checkedAt, source: "Live career check", sourceUrl: careerPageUrl };
  }
}

async function callCareerEngine(companyName: string, domain: string, website: string, forceRefresh = false) {
  if (!domain && !website) return null;
  const engineUrl = process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/intelligence-detect";
  try {
    const response = await fetch(engineUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: companyName,
        company_domain: domain,
        company_website: website,
        detect_ats: true,
        career_only: false,
        stop_on_career: false,
        require_job_detail: false,
        force_browser: false,
        force_refresh: forceRefresh,
        max_static_pages: 30,
        max_browser_steps: 10,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => ({})) as CareerEngineResponse;
    if (!response.ok || payload.ok === false) return null;
    return payload.result || null;
  } catch {
    return null;
  }
}

function hasCareer(engine: CareerEngineResult | null) {
  return Boolean(String(engine?.career_url || "").trim());
}

export async function inspectProspectCompany(input: {
  companyName: string;
  website: string;
  emails: string[];
}): Promise<ProspectCompanyIntelligence> {
  const originalDomain = resolveCompanyDomain(input.website, input.emails);
  const originalWebsite = normalizeWebsite(input.website, originalDomain);
  let crawlDomain = originalDomain;
  let crawlWebsite = originalWebsite;
  let resolutionReason = "";
  let engine = await callCareerEngine(input.companyName, crawlDomain, crawlWebsite);

  if (!hasCareer(engine) && input.companyName.trim()) {
    const alternate = await resolveAlternateCompanyWebsite(input.companyName, originalDomain);
    if (alternate) {
      crawlDomain = alternate.domain;
      crawlWebsite = alternate.website;
      resolutionReason = alternate.reason;
      engine = await callCareerEngine(input.companyName, crawlDomain, crawlWebsite, true);
    }
  }

  const careerPageUrl = String(engine?.career_url || "").trim();
  const actualAts = String(engine?.detected_ats || "").trim();
  const existingHiring = await hiringFromExistingStore([originalDomain, crawlDomain]);
  const hiring = existingHiring || await liveHiringScan(careerPageUrl, actualAts);
  const displayAts = actualAts || (careerPageUrl && hiring.status === "Accepting Applications" ? DIRECT_APPLICATION_LABEL : "");
  const engineReason = String(engine?.ats_evidence_reason || engine?.career_evidence_reason || "").trim();
  const verificationReason = [resolutionReason, engineReason].filter(Boolean).join(" ") || (originalDomain
    ? "Company domain resolved; career intelligence was inconclusive."
    : "No company domain could be resolved.");

  return {
    // Keep the original/contact domain as the CRM identity key, but use the verified current website for crawling and company_website.
    domain: originalDomain || crawlDomain,
    website: crawlWebsite || originalWebsite,
    careerPageUrl,
    detectedAts: displayAts,
    atsConfidence: actualAts ? String(engine?.ats_confidence || "") : displayAts === DIRECT_APPLICATION_LABEL ? "direct" : "",
    careerConfidence: Math.max(0, Math.min(100, Number(engine?.career_confidence_score || 0))),
    evidenceUrl: String(engine?.ats_evidence_url || engine?.career_evidence_url || careerPageUrl || crawlWebsite || ""),
    verificationReason,
    hiring,
  };
}
