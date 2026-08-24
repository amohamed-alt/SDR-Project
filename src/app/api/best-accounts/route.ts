import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listAcquisitionAccounts,
  upsertAcquisitionAccounts,
  type AcquisitionAccount,
} from "@/lib/acquisition-data-api";
import { searchAll } from "@/lib/hubspot";
import { openRouterCompletion, getOpenRouterStatus } from "@/lib/openrouter-low-cost";
import { inspectProspectCompany } from "@/lib/prospecting-company-intelligence-gemini";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("research"), domain: z.string().trim().min(3).max(255) }),
  z.object({ action: z.literal("research_top"), limit: z.number().int().min(1).max(8).default(6) }),
]);

type AiBrief = {
  whyNow: string;
  opener: string;
  risk: string;
  nextStep: string;
  model: string;
  cached: boolean;
  generatedAt: string;
};

type BestAccount = AcquisitionAccount & {
  priorityScore: number;
  priorityTier: "A+" | "A" | "B" | "C";
  recommendation: string;
  evidenceChips: string[];
  researched: boolean;
  researchConfidence: "high" | "medium" | "low";
  aiBrief: AiBrief | null;
};

function clean(value: unknown, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

function ownerAuthorized(request: NextRequest) {
  const supplied = clean(request.headers.get("x-acquisition-owner-token"), 500);
  const configured = clean(process.env.ACQUISITION_OWNER_TOKEN, 500);
  return Boolean(supplied && configured && safeEqual(supplied, configured));
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedAiBrief(account: AcquisitionAccount): AiBrief | null {
  const raw = record(record(account.evidence).bestAccountsAi);
  const whyNow = clean(raw.whyNow, 500);
  if (!whyNow) return null;
  return {
    whyNow,
    opener: clean(raw.opener, 500),
    risk: clean(raw.risk, 500),
    nextStep: clean(raw.nextStep, 500),
    model: clean(raw.model, 160),
    cached: Boolean(raw.cached),
    generatedAt: clean(raw.generatedAt, 80),
  };
}

function researchEvidence(account: AcquisitionAccount) {
  return record(record(account.evidence).bestAccountsResearch);
}

function priorityScore(account: AcquisitionAccount) {
  const research = researchEvidence(account);
  let score = Number(account.gtmScore || 0);

  if (account.phoneReadyCount && account.phoneReadyCount > 0) score += 5;
  else if (account.enrichedCount && account.enrichedCount > 0) score += 2;

  if (Number(account.headcountGrowth || 0) >= 0.12) score += 5;
  else if (Number(account.headcountGrowth || 0) >= 0.05) score += 3;

  if (Number(account.hrHeadcount || 0) >= 15) score += 3;
  else if (Number(account.hrHeadcount || 0) >= 5) score += 1;

  if (research.hasHrJobs === true) score += 5;
  if (String(research.hiringStatus || "") === "Hiring Now" && Number(research.activeJobs || 0) >= 20) score += 3;
  if (/high/i.test(String(research.atsConfidence || ""))) score += 2;

  return clamp(score);
}

function priorityTier(score: number): BestAccount["priorityTier"] {
  if (score >= 88) return "A+";
  if (score >= 78) return "A";
  if (score >= 64) return "B";
  return "C";
}

function evidenceChips(account: AcquisitionAccount) {
  const research = researchEvidence(account);
  const chips: string[] = [];
  const jobs = Math.max(Number(account.activeJobs || 0), Number(research.activeJobs || 0));
  if (jobs) chips.push(`${jobs} active jobs`);
  if (research.hasHrJobs === true) chips.push("HR / TA hiring");
  if (account.detectedAts) chips.push(account.detectedAts);
  else chips.push("ATS unverified");
  if (Number(account.headcountGrowth || 0) >= 0.05) chips.push("Headcount growing");
  if (account.phoneReadyCount && account.phoneReadyCount > 0) chips.push("Phone ready");
  if (account.peopleCount && account.peopleCount > 0) chips.push(`${account.peopleCount} people found`);
  return chips.slice(0, 5);
}

function recommendation(account: AcquisitionAccount) {
  if (account.phoneReadyCount && account.phoneReadyCount > 0) return "Call now";
  if (account.enrichedCount && account.enrichedCount > 0) return "Use verified contact";
  if (account.peopleCount && account.peopleCount > 0) return "Enrich top decision maker";
  if (account.gtmTier === "A") return "Find TA leaders";
  return "Research buying committee";
}

function asBestAccount(account: AcquisitionAccount): BestAccount {
  const score = priorityScore(account);
  const research = researchEvidence(account);
  const confidenceRaw = String(research.confidence || "").toLowerCase();
  const researchConfidence: BestAccount["researchConfidence"] = confidenceRaw === "high"
    ? "high"
    : confidenceRaw === "medium" ? "medium" : "low";
  return {
    ...account,
    priorityScore: score,
    priorityTier: priorityTier(score),
    recommendation: recommendation(account),
    evidenceChips: evidenceChips(account),
    researched: Boolean(research.checkedAt),
    researchConfidence,
    aiBrief: storedAiBrief(account),
  };
}

function parseAiJson(content: string) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      whyNow: clean(parsed.whyNow, 450),
      opener: clean(parsed.opener, 450),
      risk: clean(parsed.risk, 450),
      nextStep: clean(parsed.nextStep, 450),
    };
  } catch {
    return null;
  }
}

async function generateAiBrief(account: AcquisitionAccount, research: Record<string, unknown>) {
  if (!String(process.env.OPENROUTER_API_KEY || "").trim()) return null;

  const evidence = {
    company: account.name,
    domain: account.domain,
    country: account.country,
    employees: account.employeeCount,
    industry: account.industry,
    activeJobs: account.activeJobs,
    headcountGrowth: account.headcountGrowth,
    hrHeadcount: account.hrHeadcount,
    ats: account.detectedAts || "unknown",
    gtmScore: account.gtmScore,
    fitScore: account.fitScore,
    intentScore: account.intentScore,
    atsOpportunityScore: account.atsOpportunityScore,
    strongestSignal: account.strongestSignal,
    recommendedAngle: account.recommendedAngle,
    research,
  };

  const result = await openRouterCompletion({
    cacheKey: `best-account:${account.domain}:${account.gtmScore}:${account.activeJobs}:${account.detectedAts}:${clean(research.checkedAt, 30)}`,
    mode: "fast",
    maxOutputTokens: 190,
    temperature: 0.1,
    system: [
      "You are Talentera's evidence-first GCC account analyst.",
      "Use ONLY the supplied facts. Never invent funding, projects, stakeholders, tech, jobs, or pain.",
      "Return compact JSON only with keys whyNow, opener, risk, nextStep.",
      "whyNow: one sentence explaining why this company deserves SDR attention now.",
      "opener: one natural Saudi/GCC business-English or neutral Arabic-friendly sales angle, no fake personalization.",
      "risk: the main uncertainty or reason not to over-prioritize.",
      "nextStep: the single best SDR action.",
    ].join(" "),
    user: JSON.stringify(evidence),
  });
  const parsed = parseAiJson(result.content);
  if (!parsed || !parsed.whyNow) return null;
  return {
    ...parsed,
    model: result.model,
    cached: result.cached,
    generatedAt: new Date().toISOString(),
  } satisfies AiBrief;
}

async function hubSpotCompanyId(domain: string) {
  try {
    const matches = await searchAll("companies", ["name", "domain"], [
      { propertyName: "domain", operator: "EQ", value: domain },
    ]);
    return matches[0] ? String(matches[0].id) : "";
  } catch {
    return "";
  }
}

async function getAccount(domain: string) {
  const normalized = normalizeCompanyDomain(domain);
  const data = await listAcquisitionAccounts({ limit: 1000, includeExcluded: true });
  const account = data.accounts.find((item) => item.domain === normalized);
  if (!account) throw new Error(`Account ${normalized || domain} is not in the acquisition queue.`);
  return account;
}

async function researchAccount(input: AcquisitionAccount) {
  const existingId = await hubSpotCompanyId(input.domain);
  if (existingId) {
    const excluded: AcquisitionAccount = {
      ...input,
      hubspotCompanyId: existingId,
      exclusionStatus: "excluded",
      exclusionReason: "Already exists in HubSpot",
      status: "excluded",
      evidence: {
        ...record(input.evidence),
        bestAccountsResearch: {
          checkedAt: new Date().toISOString(),
          confidence: "high",
          hubspotProtected: true,
        },
      },
    };
    await upsertAcquisitionAccounts([excluded]);
    return excluded;
  }

  const intelligence = await inspectProspectCompany({
    companyName: input.name,
    website: input.domain ? `https://${input.domain}` : "",
    emails: [],
  });

  const jobs = intelligence.hiring.jobsSample.map((job) => ({
    title: job.title,
    location: job.location,
  }));
  const locations = [...new Set(intelligence.hiring.jobsSample.map((job) => job.location).filter(Boolean))];
  const departments = intelligence.hiring.hasHrJobs ? ["Human Resources / Talent Acquisition"] : [];
  const activeJobs = Math.max(Number(input.activeJobs || 0), Number(intelligence.hiring.activeJobs || 0));

  const scored = scoreTalenteraAccount({
    companyId: input.sourceId || input.domain,
    name: input.name,
    domain: intelligence.domain || input.domain,
    country: input.country,
    employeeCount: input.employeeCount,
    industry: input.industry,
    careerPageUrl: intelligence.careerPageUrl,
    ats: intelligence.detectedAts,
    activeJobs,
    newJobs30d: 0,
    hiringScore: intelligence.hiring.hiringScore,
    topDepartments: departments,
    topLocations: locations,
    jobs,
  });

  const confidence = intelligence.careerConfidence >= 80 && intelligence.atsConfidence
    ? "high"
    : intelligence.careerConfidence >= 55 || intelligence.hiring.status === "Hiring Now" ? "medium" : "low";
  const checkedAt = new Date().toISOString();
  const research = {
    checkedAt,
    confidence,
    website: intelligence.website,
    careerPageUrl: intelligence.careerPageUrl,
    careerConfidence: intelligence.careerConfidence,
    ats: intelligence.detectedAts,
    atsConfidence: intelligence.atsConfidence,
    evidenceUrl: intelligence.evidenceUrl,
    verificationReason: intelligence.verificationReason,
    hiringStatus: intelligence.hiring.status,
    activeJobs: intelligence.hiring.activeJobs,
    hiringScore: intelligence.hiring.hiringScore,
    hiringLabel: intelligence.hiring.hiringLabel,
    hasHrJobs: intelligence.hiring.hasHrJobs,
    hiringSource: intelligence.hiring.source,
    hiringSourceUrl: intelligence.hiring.sourceUrl,
    jobsSample: intelligence.hiring.jobsSample.slice(0, 8),
  };

  let updated: AcquisitionAccount = {
    ...input,
    domain: intelligence.domain || input.domain,
    careerPageUrl: intelligence.careerPageUrl || input.careerPageUrl,
    detectedAts: intelligence.detectedAts || input.detectedAts,
    activeJobs,
    gtmScore: scored.score,
    gtmTier: scored.tier,
    fitScore: scored.fitScore,
    intentScore: scored.intentScore,
    atsOpportunityScore: scored.atsOpportunityScore,
    primaryPersona: scored.personas.primary,
    secondaryPersona: scored.personas.secondary,
    economicBuyer: scored.personas.economicBuyer,
    technicalInfluencer: scored.personas.technicalInfluencer,
    strongestSignal: scored.signals[0]?.evidence || input.strongestSignal,
    recommendedAngle: scored.recommendedAngle,
    status: input.status === "candidate" ? "qualified" : input.status,
    evidence: {
      ...record(input.evidence),
      bestAccountsResearch: research,
    },
  };

  try {
    const aiBrief = await generateAiBrief(updated, research);
    if (aiBrief) {
      updated = {
        ...updated,
        evidence: {
          ...record(updated.evidence),
          bestAccountsAi: aiBrief,
        },
      };
    }
  } catch (error) {
    console.error("Best Accounts OpenRouter brief failed", input.domain, error);
  }

  await upsertAcquisitionAccounts([updated]);
  return updated;
}

async function researchTop(limit: number) {
  const data = await listAcquisitionAccounts({ limit: 1000, includeExcluded: false });
  const queue = data.accounts
    .filter((account) => account.exclusionStatus === "eligible" && account.status !== "pushed")
    .sort((a, b) => priorityScore(b) - priorityScore(a) || b.gtmScore - a.gtmScore || b.activeJobs - a.activeJobs)
    .slice(0, limit);

  const pending = [...queue];
  const results: Array<{ domain: string; ok: boolean; error?: string }> = [];
  const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
    while (pending.length) {
      const account = pending.shift();
      if (!account) return;
      try {
        await researchAccount(account);
        results.push({ domain: account.domain, ok: true });
      } catch (error) {
        results.push({ domain: account.domain, ok: false, error: error instanceof Error ? error.message : "Research failed" });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const includeExcluded = request.nextUrl.searchParams.get("includeExcluded") === "1";
    const data = await listAcquisitionAccounts({ limit: 1000, includeExcluded });
    const accounts = data.accounts
      .map(asBestAccount)
      .sort((a, b) => b.priorityScore - a.priorityScore || b.gtmScore - a.gtmScore || b.activeJobs - a.activeJobs || a.name.localeCompare(b.name));
    const eligible = accounts.filter((account) => account.exclusionStatus === "eligible");
    const openRouter = await getOpenRouterStatus().catch(() => null);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      accounts,
      summary: {
        total: accounts.length,
        eligible: eligible.length,
        aPlus: eligible.filter((account) => account.priorityTier === "A+").length,
        tierA: eligible.filter((account) => account.priorityTier === "A").length,
        hiringNow: eligible.filter((account) => Math.max(account.activeJobs, Number(researchEvidence(account).activeJobs || 0)) > 0).length,
        phoneReady: eligible.filter((account) => Boolean(account.phoneReadyCount)).length,
        researched: eligible.filter((account) => account.researched).length,
      },
      configuration: {
        openRouterConfigured: Boolean(String(process.env.OPENROUTER_API_KEY || "").trim()),
        openRouterModel: String(process.env.OPENROUTER_FAST_MODEL || "openai/gpt-4.1-nano"),
        openRouterPolicy: "Deterministic ranking; AI explains evidence only",
        openRouter,
        researchLimit: 8,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Best Accounts GET failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load best accounts." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site Best Accounts actions are not allowed." }, { status: 403 });
    if (!ownerAuthorized(request)) return NextResponse.json({ error: "Valid Owner key is required." }, { status: 401 });
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid Best Accounts action." }, { status: 400 });

    if (parsed.data.action === "research") {
      const account = await getAccount(parsed.data.domain);
      if (account.exclusionStatus === "excluded") return NextResponse.json({ error: `This account is excluded: ${account.exclusionReason}` }, { status: 409 });
      const updated = await researchAccount(account);
      return NextResponse.json({ action: "research", account: asBestAccount(updated) });
    }

    const results = await researchTop(parsed.data.limit);
    return NextResponse.json({
      action: "research_top",
      requested: parsed.data.limit,
      completed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    });
  } catch (error) {
    console.error("Best Accounts POST failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Best Accounts action failed." }, { status: 500 });
  }
}
