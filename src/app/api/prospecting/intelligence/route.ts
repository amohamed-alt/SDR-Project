import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HubSpotApiError, searchAll } from "@/lib/hubspot";
import { inspectProspectCompany } from "@/lib/prospecting-company-intelligence-gemini";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  linkedinUrl: z.string().trim().url().max(1000),
  company: z.string().trim().max(250).default(""),
  companyWebsite: z.string().trim().max(1000).default(""),
  companyDomain: z.string().trim().max(300).default(""),
  email: z.string().trim().max(320).default(""),
  emails: z.array(z.string().trim().max(320)).max(20).default([]),
  score: z.number().min(0).max(100).default(0),
  scoreReasons: z.array(z.object({
    label: z.string().trim().max(250),
    points: z.number().min(0).max(100),
  })).max(30).default([]),
});

type HubSpotCompanyStatus = {
  inHubSpot: boolean;
  id: string;
  matchedBy: string;
};

type HubSpotContactStatus = {
  inHubSpot: boolean;
  id: string;
  matchedBy: string;
};

function addReason(
  reasons: Array<{ label: string; points: number }>,
  label: string,
  points: number,
) {
  if (!points || reasons.some((reason) => reason.label === label)) return;
  reasons.push({ label, points });
}

async function lookupHubSpotContact(linkedinUrl: string, email: string): Promise<HubSpotContactStatus> {
  const properties = ["firstname", "lastname", "email", "company", "jobtitle"] as const;

  if (email) {
    const matches = await searchAll("contacts", properties, [
      { propertyName: "email", operator: "EQ", value: email.toLowerCase() },
    ]);
    if (matches[0]) {
      return { inHubSpot: true, id: String(matches[0].id), matchedBy: "email" };
    }
  }

  try {
    const matches = await searchAll("contacts", [...properties, "gtm_linkedin_url"], [
      { propertyName: "gtm_linkedin_url", operator: "EQ", value: linkedinUrl },
    ]);
    if (matches[0]) {
      return { inHubSpot: true, id: String(matches[0].id), matchedBy: "linkedin" };
    }
  } catch (error) {
    if (!(error instanceof HubSpotApiError) || ![400, 404].includes(error.status)) throw error;
  }

  return { inHubSpot: false, id: "", matchedBy: "" };
}

async function lookupHubSpotCompany(
  companyName: string,
  domainCandidates: string[],
): Promise<HubSpotCompanyStatus> {
  const properties = [
    "name",
    "domain",
    "account_type",
    "account_status",
    "hs_num_open_deals",
  ] as const;

  const domains = [...new Set(domainCandidates.map(normalizeCompanyDomain).filter(Boolean))];
  let company = null as Awaited<ReturnType<typeof searchAll>>[number] | null;
  let matchedBy = "";

  for (const domain of domains) {
    const matches = await searchAll("companies", properties, [
      { propertyName: "domain", operator: "EQ", value: domain },
    ]);
    if (matches[0]) {
      company = matches[0];
      matchedBy = "domain";
      break;
    }
  }

  if (!company && companyName.trim()) {
    const matches = await searchAll("companies", properties, [
      { propertyName: "name", operator: "EQ", value: companyName.trim() },
    ]);
    if (matches[0]) {
      company = matches[0];
      matchedBy = "name";
    }
  }

  if (!company) {
    return { inHubSpot: false, id: "", matchedBy: "" };
  }

  const accountType = String(company.properties.account_type || "").trim();
  const accountStatus = String(company.properties.account_status || "").trim();
  const openDealCount = Math.max(0, Number(company.properties.hs_num_open_deals || 0) || 0);
  const parts = [matchedBy];
  if (accountType) parts.push(accountType);
  if (accountStatus) parts.push(accountStatus);
  parts.push(openDealCount > 0 ? `${openDealCount} open deal${openDealCount === 1 ? "" : "s"}` : "No open deals");

  return {
    inHubSpot: true,
    id: String(company.id),
    matchedBy: parts.join(" · "),
  };
}

export async function POST(request: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid prospect intelligence request." }, { status: 400 });
    }

    const input = parsed.data;
    const contactPromise = lookupHubSpotContact(input.linkedinUrl, input.email).catch((error) => {
      console.error("Prospecting HubSpot contact check failed", error);
      return { inHubSpot: false, id: "", matchedBy: "" } satisfies HubSpotContactStatus;
    });

    const companyIntelligence = await inspectProspectCompany({
      companyName: input.company,
      website: input.companyWebsite || input.companyDomain,
      emails: input.emails.length ? input.emails : input.email ? [input.email] : [],
    });

    const [hubspotContact, hubspot] = await Promise.all([
      contactPromise,
      lookupHubSpotCompany(input.company, [
        companyIntelligence.domain,
        companyIntelligence.website,
        input.companyDomain,
        input.companyWebsite,
      ]).catch((error) => {
        console.error("Prospecting HubSpot company check failed", error);
        return { inHubSpot: false, id: "", matchedBy: "" } satisfies HubSpotCompanyStatus;
      }),
    ]);

    let score = input.score;
    const scoreReasons = [...input.scoreReasons];
    const directApplication = companyIntelligence.detectedAts === "Direct Application Form";

    if (companyIntelligence.detectedAts && !directApplication) {
      score += 4;
      addReason(scoreReasons, `ATS detected: ${companyIntelligence.detectedAts}`, 4);
    }

    if (companyIntelligence.hiring.status === "Hiring Now") {
      const hiringPoints = companyIntelligence.hiring.activeJobs >= 10 ? 10 : 6;
      score += hiringPoints;
      addReason(scoreReasons, `${companyIntelligence.hiring.activeJobs} active jobs`, hiringPoints);
    } else if (companyIntelligence.hiring.status === "Accepting Applications") {
      score += 3;
      addReason(scoreReasons, "Career application form is open", 3);
    }

    if (companyIntelligence.hiring.hasHrJobs) {
      score += 5;
      addReason(scoreReasons, "HR / recruiting roles open", 5);
    }

    score = Math.min(100, score);
    const priority = score >= 80 ? "high" : score >= 60 ? "medium" : "normal";

    return NextResponse.json({
      patch: {
        companyWebsite: companyIntelligence.website || input.companyWebsite,
        companyDomain: companyIntelligence.domain || normalizeCompanyDomain(input.companyDomain || input.companyWebsite),
        careerPageUrl: companyIntelligence.careerPageUrl,
        detectedAts: companyIntelligence.detectedAts,
        atsConfidence: companyIntelligence.atsConfidence,
        careerConfidence: companyIntelligence.careerConfidence,
        companyEvidenceUrl: companyIntelligence.evidenceUrl,
        companyVerificationReason: companyIntelligence.verificationReason,
        hiring: companyIntelligence.hiring,
        score,
        priority,
        scoreReasons,
        hubspot,
        hubspotContact,
      },
      meta: {
        provider: "Career ATS V3 + Tavily fallback + Hiring Intelligence + HubSpot status",
        completedAt: new Date().toISOString(),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Background prospect intelligence failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Company intelligence failed." },
      { status: 500 },
    );
  }
}
