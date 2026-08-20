import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { safeCompanyDomain, safeCompanyWebsite } from "@/lib/company-domain-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  linkedinUrl: z.string().trim().max(1500).default(""),
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(300).default(""),
  title: z.string().trim().max(300).default(""),
  location: z.string().trim().max(300).default(""),
  source: z.string().trim().max(120).default("Sales Nav Chrome Companion"),
});

type SearchProfile = {
  uid?: string;
  fullName?: string;
  location?: string;
  experience?: Array<{ company?: string; title?: string }>;
};

type SignalHireContact = { type?: string; value?: string; rating?: number; subType?: string | null };
type SignalHireExperience = {
  position?: string | null; company?: string | null; location?: string | null; current?: boolean;
  started?: string | null; ended?: string | null; companyUrl?: string | null; companySize?: string | null;
  staffCount?: number | string | null; industry?: string | null; website?: string | null;
};
type SignalHireCandidate = {
  uid?: string; fullName?: string; headLine?: string | null;
  locations?: Array<{ name?: string }>;
  contacts?: SignalHireContact[];
  social?: Array<{ type?: string; link?: string; rating?: number }>;
  experience?: SignalHireExperience[];
};
type SignalHireResult = { item?: string; status?: string; candidate?: SignalHireCandidate };

function normalize(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
}

function normalizeLinkedIn(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if ((host !== "linkedin.com" && !host.endsWith(".linkedin.com")) || !/^\/in\//i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}

function bestSearchMatch(profiles: SearchProfile[], name: string, company: string) {
  const targetName = normalize(name);
  const targetCompany = normalize(company);
  return [...profiles].sort((a, b) => {
    const score = (profile: SearchProfile) => {
      let total = 0;
      const profileName = normalize(profile.fullName || "");
      if (profileName === targetName) total += 100;
      else if (profileName.includes(targetName) || targetName.includes(profileName)) total += 55;
      const currentCompany = normalize(profile.experience?.[0]?.company || "");
      if (targetCompany && currentCompany === targetCompany) total += 70;
      else if (targetCompany && (currentCompany.includes(targetCompany) || targetCompany.includes(currentCompany))) total += 35;
      return total;
    };
    return score(b) - score(a);
  })[0];
}

function contacts(candidate: SignalHireCandidate, type: string, preferredSubtype?: string) {
  const sorted = (candidate.contacts || []).filter((item) => item.type === type && item.value).sort((a, b) => {
    const pa = preferredSubtype && a.subType === preferredSubtype ? 1000 : 0;
    const pb = preferredSubtype && b.subType === preferredSubtype ? 1000 : 0;
    return pb + Number(b.rating || 0) - pa - Number(a.rating || 0);
  });
  const seen = new Set<string>();
  return sorted.filter((item) => {
    const key = String(item.value || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function personaScore(title: string) {
  if (/chief (?:human resources|people)|\bchro\b|vp.*(?:hr|human resources|people)|vice president.*(?:hr|human resources|people)/i.test(title)) return 25;
  if (/head of (?:hr|human resources|people|talent|recruit)|hr director|human resources director|people director|talent acquisition director|recruitment director/i.test(title)) return 23;
  if (/talent acquisition manager|recruitment manager|recruiting manager|hr manager|human resources manager|people manager/i.test(title)) return 18;
  if (/talent acquisition|recruit|human resources|\bhr\b|people/i.test(title)) return 10;
  return 0;
}

function geographyScore(location: string) {
  if (/saudi|riyadh|jeddah|dammam|khobar|ksa/i.test(location)) return 20;
  if (/united arab emirates|dubai|abu dhabi|sharjah|\buae\b/i.test(location)) return 18;
  if (/qatar|doha|bahrain|manama|oman|muscat|kuwait|jordan|amman|egypt|cairo/i.test(location)) return 10;
  return 0;
}

function emptyHiring() {
  return { status: "Unknown" as const, activeJobs: 0, hiringScore: 0, hiringLabel: "Checking", hasHrJobs: false, source: "", sourceUrl: "", checkedAt: "", jobsSample: [] as Array<{ title: string; location: string; url: string }> };
}

export async function POST(request: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid companion prospect." }, { status: 400 });
    const apiKey = String(process.env.SIGNALHIRE_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "SIGNALHIRE_API_KEY is not configured." }, { status: 503 });

    let identifier = normalizeLinkedIn(parsed.data.linkedinUrl);
    let matchedBy = identifier ? "linkedin_url" : "signalhire_search";

    if (!identifier) {
      const searchBody: Record<string, unknown> = { fullName: parsed.data.name, size: 5 };
      if (parsed.data.company) searchBody.currentCompany = parsed.data.company;
      const searchResponse = await fetch("https://www.signalhire.com/api/v1/candidate/searchByQuery", {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(searchBody),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const searchPayload = await searchResponse.json().catch(() => null) as { profiles?: SearchProfile[]; error?: string } | null;
      if (!searchResponse.ok) {
        return NextResponse.json({ error: searchPayload?.error || `SignalHire Search API returned HTTP ${searchResponse.status}.` }, { status: searchResponse.status });
      }
      const match = bestSearchMatch(searchPayload?.profiles || [], parsed.data.name, parsed.data.company);
      if (!match?.uid) return NextResponse.json({ error: "SignalHire could not match this Sales Nav person by name + company." }, { status: 404 });
      identifier = match.uid;
    }

    const response = await fetch("https://www.signalhire.com/api/v1/candidate/search", {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [identifier], withoutWaterfall: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const creditsLeft = response.headers.get("x-credits-left");
    const payload = await response.json().catch(() => null) as SignalHireResult[] | { error?: string } | null;
    if (!response.ok) {
      const message = payload && !Array.isArray(payload) && payload.error ? payload.error : `SignalHire returned HTTP ${response.status}.`;
      return NextResponse.json({ error: message, creditsLeft }, { status: response.status });
    }
    const item = Array.isArray(payload) ? payload[0] : null;
    if (!item || item.status !== "success" || !item.candidate) return NextResponse.json({ error: "SignalHire could not resolve this person." }, { status: 404 });

    const candidate = item.candidate;
    const experiences = candidate.experience || [];
    const currentRole = experiences.find((entry) => entry.current) || experiences[0];
    const previousRole = experiences.find((entry) => entry !== currentRole && !entry.current) || experiences[1];
    const emailContacts = contacts(candidate, "email", "work");
    const phoneContacts = contacts(candidate, "phone", "mobile");
    const email = emailContacts[0] || null;
    const phone = phoneContacts[0] || null;
    const emails = emailContacts.map((entry) => String(entry.value || "").trim()).filter(Boolean);
    const phones = phoneContacts.map((entry) => String(entry.value || "").trim()).filter(Boolean);
    const location = candidate.locations?.map((entry) => entry.name).filter(Boolean).join(" · ") || currentRole?.location || parsed.data.location || "";
    const title = currentRole?.position || candidate.headLine || parsed.data.title || "";
    const companyName = currentRole?.company || parsed.data.company || "";
    const socialLinkedIn = normalizeLinkedIn((candidate.social || []).find((entry) => entry.type === "li")?.link || "");
    const linkedinUrl = socialLinkedIn || normalizeLinkedIn(parsed.data.linkedinUrl);
    if (!linkedinUrl) return NextResponse.json({ error: "SignalHire matched the person but did not return a public LinkedIn profile URL." }, { status: 422 });

    const suppliedWebsite = currentRole?.website && currentRole.website !== "n/a" ? currentRole.website : "";
    const safeSuppliedWebsite = safeCompanyWebsite(suppliedWebsite, companyName);
    const emailDomain = resolveCompanyDomain("", emails);
    const companyDomain = safeCompanyDomain(safeSuppliedWebsite || emailDomain, companyName) || safeCompanyDomain(emailDomain, companyName);
    const companyWebsite = safeSuppliedWebsite || (companyDomain ? `https://${companyDomain}` : "");

    let score = 15;
    const scoreReasons: Array<{ label: string; points: number }> = [{ label: `SignalHire matched via ${matchedBy === "linkedin_url" ? "LinkedIn" : "name + company"}`, points: 15 }];
    const persona = personaScore(title); if (persona) { score += persona; scoreReasons.push({ label: "Relevant HR / Talent persona", points: persona }); }
    const geo = geographyScore(location); if (geo) { score += geo; scoreReasons.push({ label: "Priority geography", points: geo }); }
    if (email?.value) { score += 7; scoreReasons.push({ label: "Email available", points: 7 }); }
    if (phone?.value) { score += 3; scoreReasons.push({ label: "Phone available", points: 3 }); }
    score = Math.min(100, score);

    return NextResponse.json({
      prospect: {
        uid: candidate.uid || identifier,
        linkedinUrl,
        source: parsed.data.source,
        fullName: candidate.fullName || parsed.data.name,
        headline: candidate.headLine || "",
        location,
        title,
        company: companyName,
        companyWebsite,
        companyDomain,
        companyLinkedIn: currentRole?.companyUrl && currentRole.companyUrl !== "n/a" ? currentRole.companyUrl : "",
        companySize: currentRole?.companySize && currentRole.companySize !== "n/a" ? currentRole.companySize : "",
        staffCount: currentRole?.staffCount === "n/a" ? null : currentRole?.staffCount ?? null,
        industry: currentRole?.industry && currentRole.industry !== "n/a" ? currentRole.industry : "",
        careerPageUrl: "",
        detectedAts: "",
        atsConfidence: "",
        careerConfidence: 0,
        companyEvidenceUrl: "",
        companyVerificationReason: "",
        hiring: emptyHiring(),
        currentRoleStarted: currentRole?.started || "",
        previousTitle: previousRole?.position || "",
        previousCompany: previousRole?.company || "",
        email: email?.value || "",
        emails,
        emailConfidence: email?.rating || null,
        phone: phone?.value || "",
        phones,
        phoneConfidence: phone?.rating || null,
        recentSignal: { type: "", label: "", ageDays: null },
        score,
        priority: score >= 80 ? "high" : score >= 60 ? "medium" : "normal",
        scoreReasons,
        hubspot: { inHubSpot: false, id: "", matchedBy: "" },
        hubspotContact: { inHubSpot: false, id: "", matchedBy: "" },
      },
      meta: { provider: "SignalHire companion resolve", matchedBy, creditsLeft: creditsLeft ? Number(creditsLeft) : null, intelligencePending: true },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") return NextResponse.json({ error: "SignalHire timed out. Try this lead again." }, { status: 504 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Companion prospect resolution failed." }, { status: 500 });
  }
}
