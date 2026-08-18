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

const GEMINI_MODEL = process.env.GEMINI_CAREER_MODEL || "gemini-2.5-flash-lite";
const DIRECT_APPLICATION_LABEL = "Direct Application Form";

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

type GeminiResearch = {
  official_domain?: string;
  official_website?: string;
  career_page?: string;
  ats?: string;
  hiring_status?: string;
  evidence?: string[];
};

type GeminiApiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      webSearchQueries?: string[];
    };
  }>;
  error?: { message?: string };
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

function parseJsonText(text: string): GeminiResearch | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const direct = JSON.parse(cleaned);
    return direct && typeof direct === "object" ? direct as GeminiResearch : null;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as GeminiResearch;
    } catch {
      return null;
    }
  }
}

async function researchWithGemini(companyName: string, suppliedWebsite: string, suppliedDomain: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey || !companyName.trim()) return null;

  const prompt = `You are a company career-page research agent. Use Google Search.

Company name: ${companyName}
Supplied website/domain (may be outdated or wrong): ${suppliedWebsite || suppliedDomain || "unknown"}

Find the CURRENT official company website and the official careers/jobs page. Do not assume the supplied domain is current. Search by company name and geography/brand context. Prefer a career page linked by the official company website. Identify an ATS only when there is direct evidence in the career/apply URL or page. If the company only has a CV/job application form, set ats to "Direct Application Form". Do not claim Hiring Now unless you find actual open roles; use "Accepting Applications" for a generic CV/application form.

Return ONLY one JSON object with this exact shape:
{
  "official_domain": "",
  "official_website": "",
  "career_page": "",
  "ats": "",
  "hiring_status": "Hiring Now|Accepting Applications|No Active Jobs|Unknown",
  "evidence": ["https://..."]
}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1400,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });

  const payload = await response.json().catch(() => ({})) as GeminiApiResponse;
  if (!response.ok) {
    console.error("Gemini career fallback failed", response.status, payload.error?.message || "unknown error");
    return null;
  }

  const candidate = payload.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((part) => part.text || "").join("\n").trim();
  const research = parseJsonText(text);
  if (!research) return null;

  const groundedEvidence = (candidate?.groundingMetadata?.groundingChunks || [])
    .map((chunk) => cleanUrl(chunk.web?.uri))
    .filter(Boolean);
  research.evidence = [...new Set([...(research.evidence || []).map(cleanUrl).filter(Boolean), ...groundedEvidence])].slice(0, 12);
  return research;
}

function detectAts(url: string, html: string, suggested: string) {
  const haystack = `${url}\n${html.slice(0, 1_500_000)}`;
  for (const [pattern, label] of ATS_PATTERNS) {
    if (pattern.test(haystack)) return label;
  }
  const normalized = String(suggested || "").trim();
  if (normalized && normalized !== DIRECT_APPLICATION_LABEL && ATS_PATTERNS.some(([, label]) => label.toLowerCase() === normalized.toLowerCase())) {
    return ATS_PATTERNS.find(([, label]) => label.toLowerCase() === normalized.toLowerCase())?.[1] || normalized;
  }
  return "";
}

function hasDirectApplication(html: string) {
  return /<input[^>]+type\s*=\s*["']?file|job application form|apply for a job|submit (?:your )?(?:cv|resume)|upload (?:your )?(?:cv|resume)|attach (?:your )?(?:cv|resume)|نموذج طلب التوظيف|طلب التوظيف|تحميل السيرة الذاتية|رفع السيرة الذاتية|أرسل سيرتك|ارسل سيرتك/i.test(html);
}

function companyWords(companyName: string) {
  return companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length >= 4 && !["group", "company", "holding", "holdings", "limited"].includes(word));
}

async function verifyGeminiCareer(companyName: string, research: GeminiResearch) {
  const careerCandidate = cleanUrl(research.career_page);
  if (!careerCandidate) return null;
  try {
    const response = await fetch(careerCandidate, {
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TalenteraGTM/2.2; +https://talentera.com)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 3_000_000);
    const finalUrl = response.url || careerCandidate;
    const officialDomain = normalizeCompanyDomain(research.official_domain || research.official_website);
    const careerDomain = normalizeCompanyDomain(finalUrl);
    const ats = detectAts(finalUrl, html, research.ats || "");
    const externalAts = Boolean(ats && careerDomain && officialDomain && careerDomain !== officialDomain);
    const brandMatch = companyWords(companyName).some((word) => html.toLowerCase().includes(word));
    const careerSignal = /career|careers|jobs|vacan|opportunit|employment|join us|join our team|apply|recruit|وظائف|التوظيف|انضم/i.test(html);
    if (!careerSignal) return null;
    if (!externalAts && officialDomain && careerDomain !== officialDomain && !brandMatch) return null;

    const structured = parseJobPostingJsonLd(html, finalUrl);
    const links = parseJobLinks(html, finalUrl);
    const jobs = (structured.length ? structured : links).filter((job, index, all) => {
      const key = `${String(job.url || "").toLowerCase()}|${String(job.title || "").toLowerCase()}`;
      return all.findIndex((candidate) => `${String(candidate.url || "").toLowerCase()}|${String(candidate.title || "").toLowerCase()}` === key) === index;
    });
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
        : directApplication || research.hiring_status === "Accepting Applications"
          ? "Accepting Applications"
          : "Unknown";
    const hiring: ProspectHiringInsight = {
      status,
      activeJobs,
      hiringScore: status === "Accepting Applications" ? Math.max(20, score) : score,
      hiringLabel: status === "Accepting Applications" ? "Applications Open" : hiringStatus(score),
      hasHrJobs,
      source: "Gemini Google Search + live verification",
      sourceUrl: finalUrl,
      checkedAt: new Date().toISOString(),
      jobsSample: jobs.slice(0, 5).map((job) => ({
        title: String(job.title || "Open role"),
        location: String(job.location || ""),
        url: String(job.url || finalUrl),
      })),
    };
    return {
      finalUrl,
      officialDomain,
      officialWebsite: cleanUrl(research.official_website) || (officialDomain ? `https://${officialDomain}` : ""),
      ats: ats || (directApplication ? DIRECT_APPLICATION_LABEL : ""),
      hiring,
      evidence: research.evidence || [],
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
  const free = await inspectFreeProspectCompany(input);
  if (free.careerPageUrl || !String(process.env.GEMINI_API_KEY || "").trim()) return free;

  const research = await researchWithGemini(input.companyName, input.website || free.website, free.domain);
  if (!research) return free;

  const officialWebsite = cleanUrl(research.official_website);
  if (officialWebsite) {
    const retry = await inspectFreeProspectCompany({ companyName: input.companyName, website: officialWebsite, emails: input.emails });
    if (retry.careerPageUrl) {
      return {
        ...retry,
        domain: free.domain || retry.domain,
        verificationReason: `Gemini Google Search fallback identified the current official website after the free Career V3 pass was inconclusive. ${retry.verificationReason}`,
      };
    }
  }

  const verified = await verifyGeminiCareer(input.companyName, research);
  if (!verified) return free;

  return {
    ...free,
    domain: free.domain || verified.officialDomain,
    website: verified.officialWebsite || free.website,
    careerPageUrl: verified.finalUrl,
    detectedAts: verified.ats,
    atsConfidence: verified.ats === DIRECT_APPLICATION_LABEL ? "direct" : verified.ats ? "high" : "",
    careerConfidence: 95,
    evidenceUrl: verified.evidence[0] || verified.finalUrl,
    verificationReason: "Gemini Google Search fallback found the current career destination after Career V3 was inconclusive; the returned career page was fetched and verified live before use.",
    hiring: verified.hiring,
  };
}
