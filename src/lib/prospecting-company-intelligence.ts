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

export interface ProspectHiringInsight {
  status: "Hiring Now" | "No Active Jobs" | "Unknown";
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

type CareerEngineResponse = {
  ok?: boolean;
  result?: {
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
  error?: string;
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
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TalenteraGTM/2.0; +https://talentera.com)" },
    signal: AbortSignal.timeout(22_000),
  });
  if (!response.ok) throw new Error(`Career page returned HTTP ${response.status}`);
  const text = (await response.text()).slice(0, 3_000_000);
  return { text, finalUrl: response.url || url };
}

async function hiringFromExistingStore(domain: string) {
  if (!domain) return null;
  try {
    const store = await getHiringStore();
    const match = store.companies.find((company) => normalizeCompanyDomain(company.domain) === domain);
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
    const activeJobs = jobs.length;
    const hasHrJobs = jobs.some((job) => isHrOrRecruitingRole(job.title));
    const score = calculateHiringScore({
      activeJobs,
      newJobs7d: 0,
      previousActiveJobs: 0,
      hasHrJobs,
      locationCount: new Set(jobs.map((job) => String(job.location || "").trim()).filter(Boolean)).size,
    });
    return {
      status: activeJobs > 0 ? "Hiring Now" : explicitEmpty ? "No Active Jobs" : "Unknown",
      activeJobs,
      hiringScore: score,
      hiringLabel: hiringStatus(score),
      hasHrJobs,
      source: structured.length ? "Live structured jobs" : links.length ? "Live career links" : "Live career check",
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

async function callCareerEngine(companyName: string, domain: string, website: string) {
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
        force_refresh: false,
        max_static_pages: 24,
        max_browser_steps: 8,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(105_000),
    });
    const payload = await response.json().catch(() => ({})) as CareerEngineResponse;
    if (!response.ok || payload.ok === false) return null;
    return payload.result || null;
  } catch {
    return null;
  }
}

export async function inspectProspectCompany(input: {
  companyName: string;
  website: string;
  emails: string[];
}): Promise<ProspectCompanyIntelligence> {
  const domain = resolveCompanyDomain(input.website, input.emails);
  const website = normalizeWebsite(input.website, domain);
  const engine = await callCareerEngine(input.companyName, domain, website);
  const careerPageUrl = String(engine?.career_url || "").trim();
  const detectedAts = String(engine?.detected_ats || "").trim();
  const existingHiring = await hiringFromExistingStore(domain);
  const hiring = existingHiring || await liveHiringScan(careerPageUrl, detectedAts);

  return {
    domain,
    website,
    careerPageUrl,
    detectedAts,
    atsConfidence: String(engine?.ats_confidence || ""),
    careerConfidence: Math.max(0, Math.min(100, Number(engine?.career_confidence_score || 0))),
    evidenceUrl: String(engine?.ats_evidence_url || engine?.career_evidence_url || careerPageUrl || ""),
    verificationReason: String(engine?.ats_evidence_reason || engine?.career_evidence_reason || (domain ? "Company domain resolved; career intelligence was inconclusive." : "No company domain could be resolved.")),
    hiring,
  };
}
