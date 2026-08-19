import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HubSpotApiError, searchAll } from "@/lib/hubspot";
import { inspectProspectCompany } from "@/lib/prospecting-company-intelligence-gemini";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  linkedinUrl: z.string().trim().url().max(1000),
  source: z.string().trim().max(120).default("Sales Navigator"),
});

type SignalHireContact = { type?: string; value?: string; rating?: number; subType?: string | null };
type SignalHireExperience = {
  position?: string | null; company?: string | null; location?: string | null; current?: boolean;
  started?: string | null; ended?: string | null; companyUrl?: string | null; companySize?: string | null;
  staffCount?: number | string | null; industry?: string | null; website?: string | null;
};
type SignalHireCandidate = {
  uid?: string; fullName?: string; headLine?: string | null; summary?: string | null; photo?: { url?: string } | null;
  locations?: Array<{ name?: string }>; contacts?: SignalHireContact[]; social?: Array<{ type?: string; link?: string; rating?: number }>;
  experience?: SignalHireExperience[];
};
type SignalHireResult = { item?: string; status?: string; candidate?: SignalHireCandidate };

type HubSpotCompanyStatus = {
  id: string;
  matchedBy: string;
  name: string;
  domain: string;
  accountType: string;
  accountStatus: string;
  isRetention: boolean;
  hasOpenDeal: boolean;
  openDealCount: number;
  associatedDealCount: number;
};

function normalizeLinkedInUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) throw new Error("Enter a LinkedIn profile URL.");
  if (!/^\/in\//i.test(url.pathname)) throw new Error("Only LinkedIn person profile URLs are supported.");
  url.protocol = "https:";
  url.hostname = "www.linkedin.com";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function daysSince(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function contacts(candidate: SignalHireCandidate, type: string, preferredSubtype?: string) {
  const sorted = (candidate.contacts || []).filter((item) => item.type === type && item.value).sort((a, b) => {
    const subtypeA = preferredSubtype && a.subType === preferredSubtype ? 1000 : 0;
    const subtypeB = preferredSubtype && b.subType === preferredSubtype ? 1000 : 0;
    return subtypeB + Number(b.rating || 0) - subtypeA - Number(a.rating || 0);
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
  const normalized = title.toLowerCase();
  if (/chief (?:human resources|people)|\bchro\b|vp.*(?:hr|human resources|people)|vice president.*(?:hr|human resources|people)/i.test(normalized)) return 25;
  if (/head of (?:hr|human resources|people|talent|recruit)|hr director|human resources director|people director|talent acquisition director|recruitment director/i.test(normalized)) return 23;
  if (/talent acquisition manager|recruitment manager|recruiting manager|hr manager|human resources manager|people manager/i.test(normalized)) return 18;
  if (/talent acquisition|recruit|human resources|\bhr\b|people/i.test(normalized)) return 10;
  return 0;
}

function geographyScore(location: string) {
  if (/saudi|riyadh|jeddah|dammam|khobar|ksa/i.test(location)) return 20;
  if (/united arab emirates|dubai|abu dhabi|sharjah|\buae\b/i.test(location)) return 18;
  if (/qatar|doha|bahrain|manama|oman|muscat|kuwait|jordan|amman|egypt|cairo/i.test(location)) return 10;
  return 0;
}

function companySizeScore(role?: SignalHireExperience) {
  const staff = typeof role?.staffCount === "number" ? role.staffCount : Number(role?.staffCount || 0);
  if (Number.isFinite(staff) && staff >= 1000) return 10;
  if (Number.isFinite(staff) && staff >= 200) return 8;
  const size = String(role?.companySize || "");
  if (/1000|5000|10000/i.test(size)) return 10;
  if (/200|500/i.test(size)) return 8;
  if (/50|100/i.test(size)) return 5;
  return 0;
}

function recentRoleSignal(current: SignalHireExperience | undefined, previous: SignalHireExperience | undefined) {
  const ageDays = daysSince(current?.started);
  if (ageDays === null || ageDays > 120 || !current?.company) return { type: "", label: "", ageDays };
  const sameCompany = Boolean(previous?.company && previous.company.trim().toLowerCase() === current.company.trim().toLowerCase());
  if (sameCompany && previous?.position && previous.position !== current.position) return { type: "role_change", label: `Changed role ${ageDays} days ago`, ageDays };
  if (previous?.company && !sameCompany) return { type: "job_change", label: `Changed company ${ageDays} days ago`, ageDays };
  return { type: "new_role", label: `Started current role ${ageDays} days ago`, ageDays };
}

async function lookupHubSpot(linkedinUrl: string, email: string) {
  const properties = ["firstname", "lastname", "email", "company", "jobtitle"] as const;
  if (email) {
    const matches = await searchAll("contacts", properties, [{ propertyName: "email", operator: "EQ", value: email }]);
    if (matches[0]) return { id: String(matches[0].id), matchedBy: "email" as const };
  }
  try {
    const matches = await searchAll("contacts", [...properties, "gtm_linkedin_url"], [{ propertyName: "gtm_linkedin_url", operator: "EQ", value: linkedinUrl }]);
    if (matches[0]) return { id: String(matches[0].id), matchedBy: "linkedin" as const };
  } catch (error) {
    if (!(error instanceof HubSpotApiError) || ![400, 404].includes(error.status)) throw error;
  }
  return null;
}

async function lookupHubSpotCompany(companyName: string, domainCandidates: string[]): Promise<HubSpotCompanyStatus | null> {
  const properties = [
    "name",
    "domain",
    "account_type",
    "account_status",
    "hs_num_open_deals",
    "num_associated_deals",
  ] as const;

  const domains = [...new Set(domainCandidates.map(normalizeCompanyDomain).filter(Boolean))];
  let company = null as Awaited<ReturnType<typeof searchAll>>[number] | null;
  let matchedBy = "";

  for (const domain of domains) {
    const matches = await searchAll("companies", properties, [{ propertyName: "domain", operator: "EQ", value: domain }]);
    if (matches[0]) {
      company = matches[0];
      matchedBy = "domain";
      break;
    }
  }

  if (!company && companyName.trim()) {
    const matches = await searchAll("companies", properties, [{ propertyName: "name", operator: "EQ", value: companyName.trim() }]);
    if (matches[0]) {
      company = matches[0];
      matchedBy = "name";
    }
  }

  if (!company) return null;

  const accountType = String(company.properties.account_type || "").trim();
  const accountStatus = String(company.properties.account_status || "").trim();
  const openDealCount = Math.max(0, Number(company.properties.hs_num_open_deals || 0) || 0);
  const associatedDealCount = Math.max(0, Number(company.properties.num_associated_deals || 0) || 0);
  const isRetention = accountType.toLowerCase() === "retention";
  const statusParts = [matchedBy];
  if (accountType) statusParts.push(accountType);
  if (accountStatus) statusParts.push(accountStatus);
  statusParts.push(openDealCount > 0 ? `${openDealCount} open deal${openDealCount === 1 ? "" : "s"}` : "No open deals");

  return {
    id: String(company.id),
    matchedBy: statusParts.join(" · "),
    name: String(company.properties.name || companyName || ""),
    domain: String(company.properties.domain || domains[0] || ""),
    accountType,
    accountStatus,
    isRetention,
    hasOpenDeal: openDealCount > 0,
    openDealCount,
    associatedDealCount,
  };
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    signalHireConfigured: Boolean(process.env.SIGNALHIRE_API_KEY),
    smartleadConfigured: Boolean(process.env.SMARTLEAD_API_KEY),
    companyIntelligenceConfigured: Boolean(process.env.CAREER_ENGINE_URL),
    tavilyCareerFallbackConfigured: Boolean(process.env.TAVILY_API_KEY),
    defaultSource: "Sales Navigator",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid LinkedIn profile URL." }, { status: 400 });
    const apiKey = String(process.env.SIGNALHIRE_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "SIGNALHIRE_API_KEY is not configured on the server." }, { status: 503 });

    const linkedinUrl = normalizeLinkedInUrl(parsed.data.linkedinUrl);
    const response = await fetch("https://www.signalhire.com/api/v1/candidate/search", {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [linkedinUrl], withoutWaterfall: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const creditsLeft = response.headers.get("x-credits-left");
    const payload = await response.json().catch(() => null) as SignalHireResult[] | { error?: string } | null;
    if (!response.ok) {
      const message = payload && !Array.isArray(payload) && payload.error ? payload.error : `SignalHire returned HTTP ${response.status}.`;
      return NextResponse.json({ error: message, creditsLeft }, { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
    }

    const item = Array.isArray(payload) ? payload[0] : null;
    if (!item || item.status !== "success" || !item.candidate) return NextResponse.json({ error: "SignalHire could not resolve this LinkedIn profile.", creditsLeft }, { status: 404 });

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
    const location = candidate.locations?.map((entry) => entry.name).filter(Boolean).join(" · ") || currentRole?.location || "";
    const title = currentRole?.position || candidate.headLine || "";
    const recentSignal = recentRoleSignal(currentRole, previousRole);

    const companyIntelligence = await inspectProspectCompany({
      companyName: currentRole?.company || "",
      website: currentRole?.website && currentRole.website !== "n/a" ? currentRole.website : "",
      emails,
    });

    let score = 15;
    const scoreReasons: Array<{ label: string; points: number }> = [{ label: "SignalHire profile resolved", points: 15 }];
    const persona = personaScore(title);
    if (persona) { score += persona; scoreReasons.push({ label: "Relevant HR / Talent persona", points: persona }); }
    const geo = geographyScore(location);
    if (geo) { score += geo; scoreReasons.push({ label: "Priority geography", points: geo }); }
    const companySize = companySizeScore(currentRole);
    if (companySize) { score += companySize; scoreReasons.push({ label: "Company size fit", points: companySize }); }
    if (recentSignal.type) { score += 20; scoreReasons.push({ label: recentSignal.label, points: 20 }); }
    if (email?.value) { score += 7; scoreReasons.push({ label: "Email available", points: 7 }); }
    if (phone?.value) { score += 3; scoreReasons.push({ label: "Phone available", points: 3 }); }
    const directApplication = companyIntelligence.detectedAts === "Direct Application Form";
    if (companyIntelligence.detectedAts && !directApplication) {
      score += 4;
      scoreReasons.push({ label: `ATS detected: ${companyIntelligence.detectedAts}`, points: 4 });
    }
    if (companyIntelligence.hiring.status === "Hiring Now") {
      const hiringPoints = companyIntelligence.hiring.activeJobs >= 10 ? 10 : 6;
      score += hiringPoints;
      scoreReasons.push({ label: `${companyIntelligence.hiring.activeJobs} active jobs`, points: hiringPoints });
    } else if (companyIntelligence.hiring.status === "Accepting Applications") {
      score += 3;
      scoreReasons.push({ label: "Career application form is open", points: 3 });
    }
    if (companyIntelligence.hiring.hasHrJobs) { score += 5; scoreReasons.push({ label: "HR / recruiting roles open", points: 5 }); }
    score = Math.min(100, score);

    let hubspotContact: { id: string; matchedBy: "email" | "linkedin" } | null = null;
    let hubspotCompany: HubSpotCompanyStatus | null = null;
    try {
      [hubspotContact, hubspotCompany] = await Promise.all([
        lookupHubSpot(linkedinUrl, String(email?.value || "").toLowerCase()),
        lookupHubSpotCompany(currentRole?.company || "", [
          companyIntelligence.domain,
          companyIntelligence.website,
          currentRole?.website || "",
        ]),
      ]);
    } catch (error) {
      console.error("Prospecting HubSpot CRM check failed", error);
    }

    const priority = score >= 80 ? "high" : score >= 60 ? "medium" : "normal";
    return NextResponse.json({
      prospect: {
        uid: candidate.uid || "",
        linkedinUrl,
        source: parsed.data.source,
        fullName: candidate.fullName || "Unknown profile",
        headline: candidate.headLine || "",
        photoUrl: candidate.photo?.url || "",
        location,
        title,
        company: currentRole?.company || "",
        companyWebsite: companyIntelligence.website || (currentRole?.website && currentRole.website !== "n/a" ? currentRole.website : ""),
        companyDomain: companyIntelligence.domain,
        companyLinkedIn: currentRole?.companyUrl && currentRole.companyUrl !== "n/a" ? currentRole.companyUrl : "",
        companySize: currentRole?.companySize && currentRole.companySize !== "n/a" ? currentRole.companySize : "",
        staffCount: currentRole?.staffCount === "n/a" ? null : currentRole?.staffCount ?? null,
        industry: currentRole?.industry && currentRole.industry !== "n/a" ? currentRole.industry : "",
        careerPageUrl: companyIntelligence.careerPageUrl,
        detectedAts: companyIntelligence.detectedAts,
        atsConfidence: companyIntelligence.atsConfidence,
        careerConfidence: companyIntelligence.careerConfidence,
        companyEvidenceUrl: companyIntelligence.evidenceUrl,
        companyVerificationReason: companyIntelligence.verificationReason,
        hiring: companyIntelligence.hiring,
        currentRoleStarted: currentRole?.started || "",
        previousTitle: previousRole?.position || "",
        previousCompany: previousRole?.company || "",
        email: email?.value || "",
        emails,
        emailConfidence: email?.rating || null,
        phone: phone?.value || "",
        phones,
        phoneConfidence: phone?.rating || null,
        recentSignal,
        score,
        priority,
        scoreReasons,
        hubspot: hubspotCompany
          ? { inHubSpot: true, ...hubspotCompany }
          : {
              inHubSpot: false,
              id: "",
              matchedBy: "",
              name: currentRole?.company || "",
              domain: companyIntelligence.domain,
              accountType: "",
              accountStatus: "",
              isRetention: false,
              hasOpenDeal: false,
              openDealCount: 0,
              associatedDealCount: 0,
            },
        hubspotContact: hubspotContact ? { inHubSpot: true, ...hubspotContact } : { inHubSpot: false, id: "", matchedBy: "" },
      },
      meta: {
        provider: "SignalHire + Career ATS V3 + Tavily fallback + Hiring Intelligence + HubSpot company status",
        creditsLeft: creditsLeft ? Number(creditsLeft) : null,
        tavilyCareerFallbackConfigured: Boolean(process.env.TAVILY_API_KEY),
        smartleadConfigured: Boolean(process.env.SMARTLEAD_API_KEY),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prospecting analysis failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Prospect analysis failed." }, { status: 500 });
  }
}
