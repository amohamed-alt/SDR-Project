import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Region = "Saudi Arabia" | "United Arab Emirates" | "GCC" | "All";
type SignalType = "buying_intent" | "replacement" | "pain" | "implementation" | "general" | "job_seeker";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface IntentResult {
  id: string;
  title: string;
  authorLabel: string;
  url: string;
  snippet: string;
  publishedAt: string;
  sourceScore: number;
  intentScore: number;
  signalType: SignalType;
  signalLabel: string;
  detectedRegion: string;
  detectedVendors: string[];
  matchedPhrases: string[];
}

interface SearchPayload {
  meta: {
    source: string;
    keyword: string;
    region: Region;
    minScore: number;
    fetchedAt: string;
    cached: boolean;
    queries: string[];
    providerErrors: string[];
  };
  summary: {
    total: number;
    highIntent: number;
    mediumIntent: number;
    lowIntent: number;
    buyingOrReplacement: number;
  };
  results: IntentResult[];
}

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { expiresAt: number; payload: SearchPayload }>();

const VENDORS: Array<[string, RegExp]> = [
  ["Workday", /\bworkday\b/i],
  ["SAP SuccessFactors", /\bsuccessfactors\b|\bsap recruiting\b/i],
  ["Oracle Recruiting", /\boracle recruiting\b|\btaleo\b/i],
  ["Greenhouse", /\bgreenhouse\b/i],
  ["Lever", /\blever\b/i],
  ["SmartRecruiters", /\bsmartrecruiters\b/i],
  ["iCIMS", /\bicims\b/i],
  ["Teamtailor", /\bteamtailor\b/i],
  ["Recruitee", /\brecruitee\b/i],
  ["Manatal", /\bmanatal\b/i],
  ["Zoho Recruit", /\bzoho recruit\b/i],
  ["KABi", /\bkabi\b/i],
  ["Bayt", /\bbayt\b/i],
  ["Talentera", /\btalentera\b/i],
];

const COMMERCIAL_RULES: Array<{ type: SignalType; label: string; score: number; patterns: RegExp[] }> = [
  {
    type: "buying_intent",
    label: "Buying intent",
    score: 98,
    patterns: [
      /looking for (?:an? |a new )?(?:ats|applicant tracking system|recruitment system)/i,
      /recommend(?:ation|ations)? (?:for |on )?(?:an? )?(?:ats|applicant tracking system|recruitment system)/i,
      /evaluating (?:new )?(?:ats|applicant tracking systems?|recruitment systems?|vendors?)/i,
      /shortlist(?:ing|ed)? (?:ats|applicant tracking|recruitment) (?:vendors?|systems?)/i,
      /rfp.{0,60}(?:ats|applicant tracking|recruitment system)/i,
      /need (?:an? |a new )?(?:ats|applicant tracking system|recruitment system)/i,
    ],
  },
  {
    type: "replacement",
    label: "ATS replacement",
    score: 94,
    patterns: [
      /replac(?:e|ing) (?:our |the )?(?:current )?(?:ats|applicant tracking system|recruitment system)/i,
      /switch(?:ing)? (?:from|away from|our) .{0,50}(?:ats|recruitment system|workday|successfactors|oracle|taleo|greenhouse|lever)/i,
      /migrat(?:e|ing|ion).{0,50}(?:ats|applicant tracking|recruitment system)/i,
      /new ats.{0,40}(?:vendor|platform|system|selection|rollout)/i,
    ],
  },
  {
    type: "pain",
    label: "ATS pain",
    score: 82,
    patterns: [
      /our (?:current )?(?:ats|applicant tracking system|recruitment system).{0,80}(?:slow|broken|frustrat|manual|poor|problem|issue|pain|limit)/i,
      /(?:ats|recruitment system).{0,80}(?:doesn'?t integrate|not integrating|poor candidate experience|too manual|workflow problem)/i,
      /struggl(?:e|ing).{0,80}(?:ats|recruitment system|recruitment process)/i,
    ],
  },
  {
    type: "implementation",
    label: "ATS implementation",
    score: 72,
    patterns: [
      /implement(?:ing|ation) (?:a |our |new )?(?:ats|applicant tracking system|recruitment system)/i,
      /roll(?:ing)? out (?:a |our |new )?(?:ats|applicant tracking system|recruitment system)/i,
      /go[- ]live.{0,50}(?:ats|recruitment system)/i,
    ],
  },
];

const JOB_SEEKER_PATTERNS = [
  /\bats[- ]friendly\b/i,
  /\bresume\b/i,
  /\bcv\b/i,
  /\bjob seeker\b/i,
  /\bapplying for jobs?\b/i,
  /\bbeat the ats\b/i,
  /\bget hired\b/i,
];

function cleanText(value: string, max = 900) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function canonicalLinkedInPost(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com") return "";
    if (!url.pathname.includes("/posts/") && !url.pathname.includes("/feed/update/")) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function stableId(url: string) {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `li-${(hash >>> 0).toString(36)}`;
}

function detectVendors(text: string) {
  return VENDORS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function inferRegion(text: string) {
  if (/saudi arabia|\bksa\b|riyadh|jeddah|dammam|khobar/i.test(text)) return "Saudi Arabia";
  if (/united arab emirates|\buae\b|dubai|abu dhabi|sharjah/i.test(text)) return "United Arab Emirates";
  if (/qatar|doha/i.test(text)) return "Qatar";
  if (/bahrain|manama/i.test(text)) return "Bahrain";
  if (/oman|muscat/i.test(text)) return "Oman";
  if (/kuwait/i.test(text)) return "Kuwait";
  return "";
}

function classify(text: string) {
  const matched: string[] = [];
  for (const rule of COMMERCIAL_RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match?.[0]) matched.push(cleanText(match[0], 120));
    }
    if (matched.length) {
      return { type: rule.type, label: rule.label, score: rule.score, matchedPhrases: matched.slice(0, 3) };
    }
  }

  const jobSeekerHits = JOB_SEEKER_PATTERNS.filter((pattern) => pattern.test(text)).length;
  if (jobSeekerHits >= 2) {
    return { type: "job_seeker" as const, label: "Job seeker / low intent", score: 18, matchedPhrases: [] as string[] };
  }

  const atsMention = /\bats\b|applicant tracking system|recruitment system|talent acquisition system/i.test(text);
  return {
    type: "general" as const,
    label: atsMention ? "ATS discussion" : "Recruitment discussion",
    score: atsMention ? 38 : 24,
    matchedPhrases: [] as string[],
  };
}

function authorLabelFromTitle(title: string) {
  const cleaned = cleanText(title, 180);
  if (!cleaned) return "LinkedIn post";
  const split = cleaned.split("|").map((part) => part.trim()).filter(Boolean);
  return split.length > 1 ? split[split.length - 1] : split[0];
}

function regionQuery(region: Region) {
  if (region === "Saudi Arabia") return '"Saudi Arabia" OR KSA OR Riyadh OR Jeddah';
  if (region === "United Arab Emirates") return '"United Arab Emirates" OR UAE OR Dubai OR "Abu Dhabi"';
  if (region === "GCC") return '"Saudi Arabia" OR UAE OR Qatar OR Bahrain OR Oman OR Kuwait';
  return "";
}

function buildQueries(keyword: string, region: Region) {
  const location = regionQuery(region);
  const suffix = location ? ` (${location})` : "";
  const safeKeyword = keyword.replace(/["()]/g, " ").replace(/\s+/g, " ").trim() || "ATS";
  return [
    `site:linkedin.com/posts "${safeKeyword}"${suffix}`,
    `site:linkedin.com/posts ("looking for an ATS" OR "recommend an ATS" OR "evaluating ATS" OR "replace our ATS" OR "new ATS")${suffix}`,
    `site:linkedin.com/posts ("applicant tracking system" OR "recruitment system" OR "talent acquisition system")${suffix}`,
  ];
}

async function tavilySearch(apiKey: string, query: string, maxResults: number) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const message = cleanText(await response.text().catch(() => ""), 260);
    throw new Error(`Tavily ${response.status}${message ? `: ${message}` : ""}`);
  }

  const payload = await response.json() as { results?: TavilyResult[] };
  return Array.isArray(payload.results) ? payload.results : [];
}

function summarize(results: IntentResult[]) {
  return {
    total: results.length,
    highIntent: results.filter((item) => item.intentScore >= 80).length,
    mediumIntent: results.filter((item) => item.intentScore >= 55 && item.intentScore < 80).length,
    lowIntent: results.filter((item) => item.intentScore < 55).length,
    buyingOrReplacement: results.filter((item) => item.signalType === "buying_intent" || item.signalType === "replacement").length,
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "Tavily public web index",
    linkedInLoginRequired: false,
    defaultRegion: "Saudi Arabia",
    cacheMinutes: CACHE_TTL_MS / 60_000,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const keyword = cleanText(typeof body.keyword === "string" ? body.keyword : "ATS", 120) || "ATS";
  const allowedRegions: Region[] = ["Saudi Arabia", "United Arab Emirates", "GCC", "All"];
  const region = allowedRegions.includes(body.region as Region) ? body.region as Region : "Saudi Arabia";
  const maxResults = Math.max(5, Math.min(40, Number(body.maxResults || 24) || 24));
  const minScore = Math.max(0, Math.min(100, Number(body.minScore || 0) || 0));
  const cacheKey = JSON.stringify({ keyword: keyword.toLowerCase(), region, maxResults, minScore });
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({
      ...cached.payload,
      meta: { ...cached.payload.meta, cached: true },
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-ATS-Intent-Version": "v1",
        "X-ATS-Intent-Cache": "hit",
      },
    });
  }

  const apiKey = String(process.env.TAVILY_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json({
      error: "TAVILY_API_KEY is not configured on the SDR server.",
      code: "ats_intent_search_not_configured",
    }, { status: 503 });
  }

  const queries = buildQueries(keyword, region);
  const perQuery = Math.max(5, Math.min(12, Math.ceil(maxResults / queries.length) + 3));
  const providerErrors: string[] = [];
  const settled = await Promise.allSettled(queries.map((query) => tavilySearch(apiKey, query, perQuery)));
  const rawResults: TavilyResult[] = [];

  for (const item of settled) {
    if (item.status === "fulfilled") rawResults.push(...item.value);
    else providerErrors.push(item.reason instanceof Error ? item.reason.message : "Search provider failed");
  }

  if (!rawResults.length && providerErrors.length === settled.length) {
    return NextResponse.json({
      error: "All public-web search queries failed.",
      providerErrors,
    }, { status: 502 });
  }

  const deduped = new Map<string, IntentResult>();
  for (const item of rawResults) {
    const url = canonicalLinkedInPost(String(item.url || ""));
    if (!url) continue;
    const title = cleanText(String(item.title || "LinkedIn post"), 260);
    const snippet = cleanText(String(item.content || ""), 900);
    const combined = `${title}\n${snippet}`;
    const classification = classify(combined);
    if (classification.score < minScore) continue;

    const candidate: IntentResult = {
      id: stableId(url),
      title,
      authorLabel: authorLabelFromTitle(title),
      url,
      snippet,
      publishedAt: cleanText(String(item.published_date || ""), 80),
      sourceScore: Math.round(Math.max(0, Math.min(1, Number(item.score || 0))) * 100),
      intentScore: classification.score,
      signalType: classification.type,
      signalLabel: classification.label,
      detectedRegion: inferRegion(combined),
      detectedVendors: detectVendors(combined),
      matchedPhrases: classification.matchedPhrases,
    };

    const existing = deduped.get(url);
    if (!existing || candidate.intentScore > existing.intentScore || candidate.sourceScore > existing.sourceScore) {
      deduped.set(url, candidate);
    }
  }

  const results = [...deduped.values()]
    .sort((a, b) => b.intentScore - a.intentScore || b.sourceScore - a.sourceScore)
    .slice(0, maxResults);

  const payload: SearchPayload = {
    meta: {
      source: "Tavily public web index",
      keyword,
      region,
      minScore,
      fetchedAt: new Date().toISOString(),
      cached: false,
      queries,
      providerErrors,
    },
    summary: summarize(results),
    results,
  };

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-ATS-Intent-Version": "v1",
      "X-ATS-Intent-Cache": "miss",
    },
  });
}
