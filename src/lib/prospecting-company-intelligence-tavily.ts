import {
  calculateHiringScore,
  hiringStatus,
  isHrOrRecruitingRole,
  parseJobLinks,
  parseJobPostingJsonLd,
} from "@/lib/hiring-signals-core";
import {
  inspectProspectCompany as inspectFreeProspectCompany,
  normalizeCompanyDomain,
  type ProspectCompanyIntelligence,
  type ProspectHiringInsight,
} from "@/lib/prospecting-company-intelligence";
import {
  isThirdPartyCompanyDomain,
  thirdPartyCompanyDomains,
} from "@/lib/company-domain-safety";

const DIRECT_APPLICATION_LABEL = "Direct Application Form";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const BLOCKED_RESULT_DOMAINS = [...new Set([
  ...thirdPartyCompanyDomains,
  "jobstreet.com",
  "foundit.in",
  "founditgulf.com",
  "careerbuilder.com",
])];

const ATS_PATTERNS: Array<[RegExp, string]> = [
  [/myworkdayjobs\.com|workday\.com/i, "Workday"],
  [/greenhouse\.io/i, "Greenhouse"],
  [/jobs\.lever\.co|lever\.co/i, "Lever"],
  [/smartrecruiters\.com/i, "SmartRecruiters"],
  [/successfactors\.com/i, "SAP SuccessFactors"],
  [/oraclecloud\.com|oracle\.com\/.*recruit/i, "Oracle Recruiting"],
  [/taleo\.net/i, "Oracle Taleo"],
  [/icims\.com/i, "iCIMS"],
  [/teamtailor\.com/i, "Teamtailor"],
  [/recruitee\.com/i, "Recruitee"],
  [/ashbyhq\.com/i, "Ashby"],
  [/workable\.com/i, "Workable"],
  [/jobvite\.com/i, "Jobvite"],
  [/talentera\.com/i, "Talentera"],
  [/elevatus\.io/i, "Elevatus"],
];

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResult[];
  query?: string;
  response_time?: number;
};

type VerifiedCandidate = {
  finalUrl: string;
  officialDomain: string;
  officialWebsite: string;
  ats: string;
  isCareerPage: boolean;
  hiring: ProspectHiringInsight;
  searchScore: number;
};

function cleanUrl(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function compact(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function companyVariants(companyName: string) {
  const words = companyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const stop = new Set(["group", "company", "co", "llc", "ltd", "limited", "holding", "holdings", "inc", "corp", "corporation", "the"]);
  const core = words.filter((word) => !stop.has(word));
  return [...new Set([words.join(""), core.join(""), ...core.filter((word) => word.length >= 4)])]
    .filter((value) => value.length >= 4);
}

function brandMatchScore(companyName: string, ...texts: string[]) {
  const haystack = compact(texts.join("\n").slice(0, 2_000_000));
  const variants = companyVariants(companyName);
  let score = 0;
  for (const variant of variants) {
    if (!haystack.includes(variant)) continue;
    score = Math.max(score, variant.length >= 8 ? 70 : 45);
  }
  return score;
}

function detectAts(url: string, html: string) {
  const haystack = `${url}\n${html.slice(0, 1_500_000)}`;
  for (const [pattern, label] of ATS_PATTERNS) {
    if (pattern.test(haystack)) return label;
  }
  return "";
}

function hasDirectApplication(html: string) {
  return /<input[^>]+type\s*=\s*["']?file|job application form|apply for a job|submit (?:your )?(?:cv|resume)|upload (?:your )?(?:cv|resume)|attach (?:your )?(?:cv|resume)|نموذج طلب التوظيف|طلب التوظيف|تحميل السيرة الذاتية|رفع السيرة الذاتية|أرسل سيرتك|ارسل سيرتك/i.test(html);
}

function hasCareerSignal(url: string, title: string, content: string, html: string) {
  return /career|careers|jobs|vacan|opportunit|employment|join[-\s]?us|join our team|work with us|apply|recruit|وظائف|التوظيف|انضم/i.test(
    `${url}\n${title}\n${content}\n${html.slice(0, 1_000_000)}`,
  );
}

function sanitizeFreeResult(
  companyName: string,
  result: ProspectCompanyIntelligence,
): ProspectCompanyIntelligence {
  const badDomain = result.domain && isThirdPartyCompanyDomain(result.domain, companyName);
  const badWebsite = result.website && isThirdPartyCompanyDomain(result.website, companyName);
  const badCareer = result.careerPageUrl && isThirdPartyCompanyDomain(result.careerPageUrl, companyName);
  const badEvidence = result.evidenceUrl && isThirdPartyCompanyDomain(result.evidenceUrl, companyName);

  if (!badDomain && !badWebsite && !badCareer) return result;

  const rejected = [
    badDomain ? result.domain : "",
    badWebsite ? result.website : "",
    badCareer ? result.careerPageUrl : "",
  ].filter(Boolean).join(", ");

  return {
    ...result,
    domain: badDomain ? "" : result.domain,
    website: badWebsite ? "" : result.website,
    careerPageUrl: badCareer ? "" : result.careerPageUrl,
    detectedAts: badCareer ? "" : result.detectedAts,
    atsConfidence: badCareer ? "" : result.atsConfidence,
    careerConfidence: badCareer ? 0 : result.careerConfidence,
    evidenceUrl: badEvidence ? "" : result.evidenceUrl,
    verificationReason: [
      `Rejected third-party job board/aggregator as company identity${rejected ? `: ${rejected}` : ""}.`,
      result.verificationReason,
    ].filter(Boolean).join(" "),
  };
}

async function tavilySearch(companyName: string, suppliedDomain: string) {
  const apiKey = String(process.env.TAVILY_API_KEY || "").trim();
  if (!apiKey || !companyName.trim()) return [] as TavilyResult[];

  const domainHint = suppliedDomain ? ` The supplied domain ${suppliedDomain} may be outdated.` : "";
  const response = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `\"${companyName}\" official company website careers jobs.${domainHint} Do not return job boards, recruitment marketplaces, directories, or company profile aggregators.`,
      topic: "general",
      search_depth: "basic",
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
      exclude_domains: BLOCKED_RESULT_DOMAINS,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    console.error("Tavily career fallback failed", response.status, (await response.text()).slice(0, 500));
    return [];
  }
  const payload = await response.json().catch(() => ({})) as TavilyResponse;
  return (payload.results || [])
    .filter((result) => {
      const url = cleanUrl(result.url);
      return Boolean(url) && !isThirdPartyCompanyDomain(url, companyName);
    })
    .sort((a, b) => {
      const aCareer = /career|jobs|vacan|join|recruit|employment/i.test(`${a.url} ${a.title}`) ? 0.2 : 0;
      const bCareer = /career|jobs|vacan|join|recruit|employment/i.test(`${b.url} ${b.title}`) ? 0.2 : 0;
      return Number(b.score || 0) + bCareer - Number(a.score || 0) - aCareer;
    });
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

function buildHiring(html: string, finalUrl: string, source: string): ProspectHiringInsight {
  const structured = parseJobPostingJsonLd(html, finalUrl);
  const links = parseJobLinks(html, finalUrl);
  const jobs = uniqueJobs(structured.length ? structured : links);
  const directApplication = hasDirectApplication(html);
  const explicitEmpty = /(?:no|without)\s+(?:current\s+)?(?:openings|vacancies|positions|jobs)|(?:currently|presently)\s+(?:have|has|with)\s+no\s+(?:openings|vacancies|positions|jobs)/i.test(html);
  const activeJobs = jobs.length;
  const hasHrJobs = jobs.some((job) => isHrOrRecruitingRole(String(job.title || "")));
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
    hiringScore: status === "Accepting Applications" ? Math.max(20, score) : score,
    hiringLabel: status === "Accepting Applications" ? "Applications Open" : hiringStatus(score),
    hasHrJobs,
    source,
    sourceUrl: finalUrl,
    checkedAt: new Date().toISOString(),
    jobsSample: jobs.slice(0, 5).map((job) => ({
      title: String(job.title || "Open role"),
      location: String(job.location || ""),
      url: String(job.url || finalUrl),
    })),
  };
}

async function verifyResult(companyName: string, result: TavilyResult): Promise<VerifiedCandidate | null> {
  const candidateUrl = cleanUrl(result.url);
  if (!candidateUrl || isThirdPartyCompanyDomain(candidateUrl, companyName)) return null;
  try {
    const response = await fetch(candidateUrl, {
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TalenteraGTM/2.4; +https://talentera.com)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!/html|text/i.test(contentType)) return null;
    const html = (await response.text()).slice(0, 3_000_000);
    const finalUrl = response.url || candidateUrl;
    if (isThirdPartyCompanyDomain(finalUrl, companyName)) return null;

    const title = String(result.title || "");
    const content = String(result.content || "");
    const brandScore = brandMatchScore(companyName, html, title, content, finalUrl);
    if (brandScore < 45) return null;

    const final = new URL(finalUrl);
    const officialDomain = normalizeCompanyDomain(finalUrl);
    const officialWebsite = `${final.protocol}//${final.host}/`;
    const ats = detectAts(finalUrl, html);
    const isCareerPage = hasCareerSignal(finalUrl, title, content, html);
    return {
      finalUrl,
      officialDomain,
      officialWebsite,
      ats: ats || (isCareerPage && hasDirectApplication(html) ? DIRECT_APPLICATION_LABEL : ""),
      isCareerPage,
      hiring: buildHiring(html, finalUrl, "Tavily search + live verification"),
      searchScore: Number(result.score || 0),
    };
  } catch {
    return null;
  }
}

export async function inspectProspectCompany(input: {
  companyName: string;
  website: string;
  emails: string[];
}): Promise<ProspectCompanyIntelligence> {
  const free = sanitizeFreeResult(input.companyName, await inspectFreeProspectCompany(input));
  if (free.careerPageUrl || !String(process.env.TAVILY_API_KEY || "").trim() || !input.companyName.trim()) {
    return free;
  }

  const results = await tavilySearch(input.companyName, free.domain || normalizeCompanyDomain(input.website));
  if (!results.length) return free;

  let bestWebsite: VerifiedCandidate | null = null;
  for (const result of results) {
    const verified = await verifyResult(input.companyName, result);
    if (!verified) continue;
    if (!bestWebsite || verified.searchScore > bestWebsite.searchScore) bestWebsite = verified;

    const retry = sanitizeFreeResult(input.companyName, await inspectFreeProspectCompany({
      companyName: input.companyName,
      website: verified.officialWebsite,
      emails: input.emails,
    }));
    if (retry.careerPageUrl) {
      return {
        ...retry,
        domain: verified.officialDomain || retry.domain || free.domain,
        website: verified.officialWebsite || retry.website,
        verificationReason: `Tavily fallback identified and live-verified the current official website after Career V3 was inconclusive. ${retry.verificationReason}`,
      };
    }

    if (verified.isCareerPage) {
      return {
        ...free,
        domain: verified.officialDomain || free.domain,
        website: verified.officialWebsite || free.website,
        careerPageUrl: verified.finalUrl,
        detectedAts: verified.ats,
        atsConfidence: verified.ats === DIRECT_APPLICATION_LABEL ? "direct" : verified.ats ? "high" : "",
        careerConfidence: 95,
        evidenceUrl: verified.finalUrl,
        verificationReason: "Tavily fallback found a career destination after Career V3 was inconclusive; the result was fetched, checked against third-party job boards, and brand/career verified live before use.",
        hiring: verified.hiring,
      };
    }
  }

  if (bestWebsite) {
    return {
      ...free,
      domain: bestWebsite.officialDomain || free.domain,
      website: bestWebsite.officialWebsite || free.website,
      evidenceUrl: bestWebsite.finalUrl || free.evidenceUrl,
      verificationReason: "Tavily fallback live-verified a current official website, but no sufficiently verified career page was found.",
    };
  }

  return free;
}
