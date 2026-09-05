import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as acquisitionPost } from "@/app/api/acquisition/route";
import { POST as prospectingPushPost } from "@/app/api/prospecting/push/route";
import {
  getAcquisitionAccount,
  listAcquisitionAccounts,
  listAcquisitionPeople,
  type AcquisitionAccount,
  type AcquisitionPerson,
} from "@/lib/acquisition-data-api";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  action: z.literal("push_ready"),
  domains: z.array(z.string().trim().min(3).max(255)).min(1).max(50),
});

function clean(value: unknown, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

function reachable(person: AcquisitionPerson) {
  return person.enrichmentStatus === "enriched" && Boolean(person.emails.length || person.phones.length);
}

function personPriority(person: AcquisitionPerson) {
  return (person.phones.length ? 1000 : 0) + (person.emails.length ? 100 : 0) + person.rankScore;
}

async function bestReadyPerson(domain: string) {
  const people = (await listAcquisitionPeople(domain)).people || [];
  return [...people].filter(reachable).sort((a, b) => personPriority(b) - personPriority(a))[0] || null;
}

async function assignment(origin: string, request: NextRequest, account: AcquisitionAccount) {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  const assignRequest = new NextRequest(`${origin}/api/acquisition`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "assign", domain: account.domain }),
  });
  const response = await acquisitionPost(assignRequest);
  const result = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(result.error || `Assignment failed (${response.status}).`);
  const assigned = result.assignment as { ownerId?: string; ownerName?: string } | undefined;
  if (!assigned?.ownerId) throw new Error("No SDR owner was returned for this account.");
  return { ownerId: assigned.ownerId, ownerName: assigned.ownerName || "" };
}

async function pushExistingReadyContact(
  origin: string,
  request: NextRequest,
  account: AcquisitionAccount,
  person: AcquisitionPerson,
) {
  const assigned = await assignment(origin, request, account);
  const ownerToken = clean(process.env.ACQUISITION_OWNER_TOKEN || process.env.DASHBOARD_PASSWORD || process.env.SDR_ADMIN_PASSWORD, 500);
  if (!ownerToken) throw new Error("Acquisition owner authorization is not configured.");
  if (account.domain.endsWith(".invalid")) throw new Error("Domain-pending coverage records cannot be pushed to HubSpot.");

  const pushRequest = new Request(`${origin}/api/prospecting/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acquisition-owner-token": ownerToken,
    },
    body: JSON.stringify({
      linkedinUrl: person.linkedinUrl,
      source: "Zero-Credit Ready Queue",
      signalHireUid: person.uid,
      assignmentMode: "acquisition",
      ownerId: assigned.ownerId,
      ownerName: assigned.ownerName,
      fullName: person.fullName,
      title: person.title,
      company: account.name,
      companyWebsite: `https://${account.domain}`,
      companyDomain: account.domain,
      careerPageUrl: account.careerPageUrl,
      detectedAts: account.detectedAts,
      atsConfidence: account.detectedAts ? "verified" : "",
      careerConfidence: 0,
      companyEvidenceUrl: account.careerPageUrl,
      companyVerificationReason: account.strongestSignal,
      hiring: {
        status: account.activeJobs > 0 ? "Hiring Now" : "Unknown",
        activeJobs: account.activeJobs,
        hiringScore: account.intentScore,
        hiringLabel: account.strongestSignal,
        hasHrJobs: /recruit|talent|hris|human resources|\bhr\b/i.test(account.strongestSignal),
        source: account.source,
        sourceUrl: account.careerPageUrl,
        checkedAt: new Date().toISOString(),
        jobsSample: [],
      },
      location: person.location,
      email: person.emails[0] || "",
      emails: person.emails,
      phone: person.phones[0] || "",
      phones: person.phones,
      score: account.gtmScore,
      priority: person.phones.length ? "high" : account.gtmTier === "A" ? "high" : account.gtmTier === "B" ? "medium" : "normal",
      previousTitle: "",
      previousCompany: "",
      recentSignal: { type: "", label: account.strongestSignal },
      scoreReasons: [
        { label: `GTM Tier ${account.gtmTier}`, points: Math.min(100, account.gtmScore) },
        { label: "Intent score", points: Math.min(100, account.intentScore) },
        { label: "Persona match", points: Math.min(100, person.rankScore) },
      ],
    }),
  });

  const response = await prospectingPushPost(pushRequest);
  const result = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(result.error || `HubSpot push failed (${response.status}).`);
  return { assigned, result };
}

async function allReadyAccounts() {
  const first = await listAcquisitionAccounts({ limit: 1000, offset: 0, includeExcluded: true, readiness: "ready" });
  const accounts = [...first.accounts];
  const total = Number(first.pagination?.filteredTotal || accounts.length);
  for (let offset = 1000; offset < total; offset += 1000) {
    const page = await listAcquisitionAccounts({ limit: 1000, offset, includeExcluded: true, readiness: "ready" });
    accounts.push(...page.accounts);
  }
  return { data: first, accounts };
}

export async function GET() {
  try {
    const { data, accounts } = await allReadyAccounts();
    const rows = accounts.map((account) => ({
      domain: account.domain,
      name: account.name,
      country: account.country,
      gtmTier: account.gtmTier,
      gtmScore: account.gtmScore,
      status: account.status,
      exclusionStatus: account.exclusionStatus,
      peopleCount: Number(account.peopleCount || 0),
      enrichedCount: Number(account.enrichedCount || 0),
      phoneReadyCount: Number(account.phoneReadyCount || 0),
      pushCount: Number(account.pushCount || 0),
      ready: account.exclusionStatus === "eligible"
        && account.status !== "pushed"
        && !account.domain.endsWith(".invalid")
        && Number(account.enrichedCount || 0) > 0,
    }));
    const summary = data.summary;
    return NextResponse.json({
      zeroCreditMode: true,
      policy: "Uses only people and contact details already stored in Postgres. No Apollo search and no SignalHire contact reveal is performed.",
      summary: {
        stored: Number(summary.total || 0),
        ready: Number(summary.ready || 0),
        needsPeople: Number(summary.needs_people || 0),
        searchOnly: Number(summary.search_only || 0),
        pushed: Number(summary.pushed || 0),
      },
      accounts: rows,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load zero-credit ready queue." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site actions are not allowed." }, { status: 403 });
    if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Admin authorization is required." }, { status: 401 });
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid zero-credit ready action." }, { status: 400 });

    const outcomes: Array<Record<string, unknown>> = [];
    for (const domain of [...new Set(parsed.data.domains)]) {
      const account = await getAcquisitionAccount(domain);
      if (!account || account.exclusionStatus !== "eligible" || account.status === "pushed" || account.domain.endsWith(".invalid")) {
        outcomes.push({ domain, status: "not_eligible" });
        continue;
      }
      const person = await bestReadyPerson(domain);
      if (!person) {
        outcomes.push({ domain, status: "not_ready", reason: "No already-enriched stored contact exists." });
        continue;
      }
      try {
        const pushed = await pushExistingReadyContact(request.nextUrl.origin, request, account, person);
        outcomes.push({
          domain,
          account: account.name,
          person: person.fullName,
          title: person.title,
          status: pushed.result.duplicate ? "duplicate_task" : "pushed",
          ownerId: pushed.assigned.ownerId,
          ownerName: pushed.assigned.ownerName,
          contactId: pushed.result.contactId,
          companyId: pushed.result.companyId,
          taskId: pushed.result.taskId,
        });
      } catch (error) {
        outcomes.push({ domain, account: account.name, status: "failed", error: error instanceof Error ? error.message : "Push failed" });
      }
    }

    return NextResponse.json({
      zeroCreditMode: true,
      selected: parsed.data.domains.length,
      pushed: outcomes.filter((item) => item.status === "pushed").length,
      duplicates: outcomes.filter((item) => item.status === "duplicate_task").length,
      skipped: outcomes.filter((item) => item.status === "not_ready" || item.status === "not_eligible").length,
      failed: outcomes.filter((item) => item.status === "failed").length,
      costGuard: { apolloCredits: 0, signalHireContactCredits: 0, signalHireSearchCalls: 0 },
      outcomes,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Zero-credit ready push failed." }, { status: 500 });
  }
}
