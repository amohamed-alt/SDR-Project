import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TavilyResult = { title?: string; url?: string; content?: string; score?: number };
type SignalHireContact = { type?: string; value?: string; rating?: number; subType?: string | null };
type SignalHireExperience = {
  position?: string | null;
  company?: string | null;
  location?: string | null;
  current?: boolean;
  companyUrl?: string | null;
  companySize?: string | null;
  staffCount?: number | string | null;
  industry?: string | null;
  website?: string | null;
};
type SignalHireCandidate = {
  uid?: string;
  fullName?: string;
  headLine?: string | null;
  photo?: { url?: string } | null;
  locations?: Array<{ name?: string }>;
  contacts?: SignalHireContact[];
  experience?: SignalHireExperience[];
};
type SignalHireResult = { item?: string; status?: string; candidate?: SignalHireCandidate };

function clean(value: unknown, max = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function canonicalProfileUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" || !/^\/in\//i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeName(value: string) {
  return clean(value, 180)
    .replace(/\s+(?:on LinkedIn|\| LinkedIn).*$/i, "")
    .replace(/^LinkedIn\s*[-:|]\s*/i, "")
    .replace(/[|:–—-]+$/g, "")
    .trim();
}

function authorNameFromInput(title: string, authorLabel: string) {
  const fromTitle = clean(title, 220).match(/^(.{2,100}?)\s+(?:on LinkedIn|\|\s*LinkedIn|:\s*LinkedIn)/i)?.[1];
  const candidate = normalizeName(fromTitle || authorLabel || title);
  if (!candidate || /linkedin post|linkedin|ats|applicant tracking/i.test(candidate) || candidate.split(/\s+/).length > 8) return "";
  return candidate;
}

function nameTokens(value: string) {
  return normalizeName(value).toLowerCase().replace(/[^a-z0-9\u0600-\u06ff ]/g, " ").split(/\s+/).filter((token) => token.length >= 2);
}

function profileConfidence(authorName: string, item: TavilyResult, region: string) {
  const haystack = `${clean(item.title, 300)} ${clean(item.content, 500)}`.toLowerCase();
  const tokens = nameTokens(authorName);
  if (!tokens.length) return 0;
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  let score = Math.round((matches / tokens.length) * 75);
  if (region && haystack.includes(region.toLowerCase())) score += 8;
  if (/talent acquisition|recruit|human resources|\bhr\b|people|hris/i.test(haystack)) score += 7;
  score += Math.round(Math.max(0, Math.min(1, Number(item.score || 0))) * 10);
  return Math.min(100, score);
}

async function tavilySearch(apiKey: string, query: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Tavily profile search failed (${response.status}).`);
  const payload = await response.json() as { results?: TavilyResult[] };
  return Array.isArray(payload.results) ? payload.results : [];
}

async function findProfile(authorName: string, region: string, context: string, apiKey: string) {
  const safeRegion = clean(region, 100);
  const contextHint = clean(context, 120).replace(/["()]/g, " ");
  const queries = [
    `site:linkedin.com/in "${authorName.replace(/"/g, "")}" ${safeRegion ? `"${safeRegion}"` : ""}`.trim(),
    `site:linkedin.com/in "${authorName.replace(/"/g, "")}" ("talent acquisition" OR recruitment OR HR OR HRIS) ${contextHint}`.trim(),
  ];
  const settled = await Promise.allSettled(queries.map((query) => tavilySearch(apiKey, query)));
  const candidates = new Map<string, { url: string; title: string; snippet: string; confidence: number }>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const url = canonicalProfileUrl(clean(item.url, 1000));
      if (!url) continue;
      const confidence = profileConfidence(authorName, item, safeRegion);
      const existing = candidates.get(url);
      if (!existing || confidence > existing.confidence) {
        candidates.set(url, { url, title: clean(item.title, 300), snippet: clean(item.content, 500), confidence });
      }
    }
  }
  return [...candidates.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function contacts(candidate: SignalHireCandidate, type: string, preferredSubtype?: string) {
  const seen = new Set<string>();
  return (candidate.contacts || [])
    .filter((item) => item.type === type && item.value)
    .sort((a, b) => {
      const preferredA = preferredSubtype && a.subType === preferredSubtype ? 1000 : 0;
      const preferredB = preferredSubtype && b.subType === preferredSubtype ? 1000 : 0;
      return preferredB + Number(b.rating || 0) - preferredA - Number(a.rating || 0);
    })
    .filter((item) => {
      const key = clean(item.value, 320).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeDomain(raw: string) {
  const input = clean(raw, 500);
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (/linkedin\.com|bayt\.com|wuzzuf\.net|indeed\./i.test(host)) return "";
    return host;
  } catch {
    return "";
  }
}

async function signalHire(profileUrl: string, apiKey: string) {
  const response = await fetch("https://www.signalhire.com/api/v1/candidate/search", {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [profileUrl], withoutWaterfall: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const creditsLeft = response.headers.get("x-credits-left");
  const payload = await response.json().catch(() => null) as SignalHireResult[] | { error?: string } | null;
  if (!response.ok) {
    const detail = payload && !Array.isArray(payload) ? clean(payload.error, 300) : "";
    throw new Error(detail || `SignalHire returned HTTP ${response.status}.`);
  }
  const item = Array.isArray(payload) ? payload[0] : null;
  if (!item || item.status !== "success" || !item.candidate) throw new Error("SignalHire could not resolve the selected LinkedIn profile.");
  return { candidate: item.candidate, creditsLeft: creditsLeft ? Number(creditsLeft) : null };
}

function emptyHiring() {
  return { status: "Unknown", activeJobs: 0, hiringScore: 0, hiringLabel: "", hasHrJobs: false, source: "", sourceUrl: "", checkedAt: "", jobsSample: [] as Array<{ title: string; location: string; url: string }> };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = clean(body.title, 300);
    const authorLabel = clean(body.authorLabel, 200);
    const snippet = clean(body.snippet, 1000);
    const region = clean(body.region, 100);
    const signalLabel = clean(body.signalLabel, 120) || "ATS intent signal";
    const intentScore = Math.max(0, Math.min(100, Number(body.intentScore || 0)));
    const matchedPhrase = clean(Array.isArray(body.matchedPhrases) ? body.matchedPhrases[0] : "", 250);
    const vendors = Array.isArray(body.detectedVendors) ? body.detectedVendors.map((item) => clean(item, 100)).filter(Boolean).slice(0, 5) : [];
    const postUrl = clean(body.postUrl || body.url, 1200);
    const explicitProfileUrl = canonicalProfileUrl(clean(body.profileUrl, 1200));
    const authorName = authorNameFromInput(title, authorLabel);

    const tavilyKey = String(process.env.TAVILY_API_KEY || "").trim();
    const signalHireKey = String(process.env.SIGNALHIRE_API_KEY || "").trim();
    if (!signalHireKey) return NextResponse.json({ error: "SIGNALHIRE_API_KEY is not configured." }, { status: 503 });
    if (!explicitProfileUrl && !tavilyKey) return NextResponse.json({ error: "TAVILY_API_KEY is required to resolve the post author profile." }, { status: 503 });
    if (!explicitProfileUrl && !authorName) {
      return NextResponse.json({ error: "The public search result did not expose a reliable author name. Open the post and provide the author's LinkedIn profile URL.", needsProfileUrl: true }, { status: 422 });
    }

    const context = [signalLabel, ...vendors].join(" ");
    const profileCandidates = explicitProfileUrl ? [{ url: explicitProfileUrl, title: authorName, snippet: "Explicit profile URL", confidence: 100 }] : await findProfile(authorName, region, context, tavilyKey);
    const best = profileCandidates[0];
    if (!best || best.confidence < 72) {
      return NextResponse.json({
        error: "Author profile match is not confident enough for automatic SignalHire spending.",
        needsProfileConfirmation: true,
        authorName,
        candidates: profileCandidates,
      }, { status: 409 });
    }

    const resolved = await signalHire(best.url, signalHireKey);
    const candidate = resolved.candidate;
    const experiences = candidate.experience || [];
    const currentRole = experiences.find((entry) => entry.current) || experiences[0];
    const previousRole = experiences.find((entry) => entry !== currentRole && !entry.current) || experiences[1];
    const emailContacts = contacts(candidate, "email", "work");
    const phoneContacts = contacts(candidate, "phone", "mobile");
    const emails = emailContacts.map((item) => clean(item.value, 320)).filter(Boolean);
    const phones = phoneContacts.map((item) => clean(item.value, 120)).filter(Boolean);
    const location = candidate.locations?.map((item) => clean(item.name, 200)).filter(Boolean).join(" · ") || clean(currentRole?.location, 300);
    const company = clean(currentRole?.company, 250);
    const companyDomain = normalizeDomain(clean(currentRole?.website, 500)) || (emails[0]?.includes("@") ? normalizeDomain(emails[0].split("@")[1]) : "");
    const companyWebsite = companyDomain ? `https://${companyDomain}` : "";
    const titleValue = clean(currentRole?.position || candidate.headLine, 250);
    const vendorMention = vendors.length ? ` Vendor mention: ${vendors.join(", ")} (signal only; not verified as current ATS).` : "";
    let score = Math.round(35 + intentScore * 0.5 + best.confidence * 0.1);
    const scoreReasons = [
      { label: `${signalLabel} from public LinkedIn post`, points: Math.round(intentScore * 0.35) },
      { label: `Author/profile match confidence ${best.confidence}%`, points: 10 },
    ];
    if (vendors.length) scoreReasons.push({ label: `ATS vendor mentioned in signal: ${vendors.join(", ")} (not verified current ATS)`, points: 0 });
    if (emails[0]) { score += 7; scoreReasons.push({ label: "Work email available", points: 7 }); }
    if (phones[0]) { score += 3; scoreReasons.push({ label: "Phone available", points: 3 }); }
    score = Math.min(100, score);
    const priority = score >= 80 ? "high" : score >= 60 ? "medium" : "normal";

    return NextResponse.json({
      author: { name: authorName || candidate.fullName || "", profileUrl: best.url, matchConfidence: best.confidence, candidates: profileCandidates },
      signal: { postUrl, signalLabel, intentScore, matchedPhrase, detectedVendors: vendors, region, snippet },
      prospect: {
        linkedinUrl: best.url,
        source: "LinkedIn ATS Intent",
        fullName: clean(candidate.fullName, 250) || authorName || "LinkedIn author",
        title: titleValue,
        company,
        companyWebsite,
        companyDomain,
        companyLinkedIn: clean(currentRole?.companyUrl, 1000),
        careerPageUrl: "",
        // A vendor mentioned in a post is a sales signal, not proof of the company's current ATS.
        // Leave verified ATS fields blank so /api/prospecting/push cannot contaminate HubSpot.
        detectedAts: "",
        atsConfidence: "",
        careerConfidence: 0,
        companyEvidenceUrl: postUrl,
        companyVerificationReason: `${matchedPhrase || signalLabel}.${vendorMention}`.trim(),
        hiring: emptyHiring(),
        location,
        email: emails[0] || "",
        emails,
        phone: phones[0] || "",
        phones,
        score,
        priority,
        previousTitle: clean(previousRole?.position, 250),
        previousCompany: clean(previousRole?.company, 250),
        recentSignal: {
          type: "linkedin_ats_intent",
          label: `${matchedPhrase ? `${signalLabel}: ${matchedPhrase}` : signalLabel}${vendorMention}`.trim(),
          ageDays: null,
        },
        scoreReasons,
      },
      meta: { provider: "Tavily public profile discovery + SignalHire", creditsLeft: resolved.creditsLeft, safeMatchThreshold: 72 },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ATS intent enrichment failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "ATS intent enrichment failed." }, { status: 500 });
  }
}