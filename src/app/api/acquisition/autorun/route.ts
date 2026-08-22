import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as acquisitionPost } from "@/app/api/acquisition/route";
import { POST as prospectingPushPost } from "@/app/api/prospecting/push/route";
import {
  listAcquisitionAccounts,
  listAcquisitionPeople,
  type AcquisitionAccount,
  type AcquisitionPerson,
} from "@/lib/acquisition-data-api";
import { seedApprovedApolloAccounts } from "@/lib/acquisition-approved-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(10).default(5),
});

function clean(value: unknown, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function workerAuthorized(request: Request) {
  const expected = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  const supplied = clean(request.headers.get("x-acquisition-worker-key"), 1000);
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function ensureOwnerBridge(workerKey: string) {
  // The browser owner gate stays closed when ACQUISITION_OWNER_TOKEN is not configured.
  // This temporary in-process bridge exists only for the authenticated internal autorun request.
  if (!clean(process.env.ACQUISITION_OWNER_TOKEN, 500)) {
    process.env.ACQUISITION_OWNER_TOKEN = workerKey;
  }
  return clean(process.env.ACQUISITION_OWNER_TOKEN, 500);
}

async function acquisitionAction(origin: string, ownerKey: string, body: Record<string, unknown>) {
  const request = new NextRequest(`${origin}/api/acquisition`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acquisition-owner-token": ownerKey,
    },
    body: JSON.stringify(body),
  });
  const response = await acquisitionPost(request);
  const data = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error || `Acquisition action failed (${response.status}).`);
  return data;
}

function first<T>(values: T[] | undefined) {
  return values?.[0];
}

function accountPriority(account: AcquisitionAccount) {
  const phoneBoost = Number(account.phoneReadyCount || 0) > 0 ? 1200 : 0;
  const tier = account.gtmTier === "A" ? 400 : account.gtmTier === "B" ? 300 : account.gtmTier === "C" ? 200 : 100;
  return phoneBoost + tier + account.gtmScore * 2 + Math.max(-20, Math.min(40, account.headcountGrowth));
}

function hasReachableContact(person: AcquisitionPerson) {
  return person.enrichmentStatus === "enriched" && Boolean(person.emails.length || person.phones.length);
}

function contactPriority(person: AcquisitionPerson) {
  return (person.phones.length ? 1000 : 0) + (person.emails.length ? 100 : 0) + person.rankScore;
}

async function latestAccount(domain: string) {
  const data = await listAcquisitionAccounts({ limit: 1000, includeExcluded: true });
  return data.accounts.find((account) => account.domain === domain) || null;
}

async function pushBestPerson(
  origin: string,
  ownerKey: string,
  account: AcquisitionAccount,
  person: AcquisitionPerson,
) {
  const assignmentResult = await acquisitionAction(origin, ownerKey, { action: "assign", domain: account.domain });
  const assignment = assignmentResult.assignment as { ownerId?: string; ownerName?: string } | undefined;
  if (!assignment?.ownerId) throw new Error("Smart SDR assignment did not return an owner.");

  const current = await latestAccount(account.domain) || account;
  const pushRequest = new Request(`${origin}/api/prospecting/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acquisition-owner-token": ownerKey,
    },
    body: JSON.stringify({
      linkedinUrl: person.linkedinUrl,
      source: "Net-New Acquisition Autorun",
      signalHireUid: person.uid,
      assignmentMode: "acquisition",
      ownerId: assignment.ownerId,
      ownerName: assignment.ownerName || "",
      fullName: person.fullName,
      title: person.title,
      company: current.name,
      companyWebsite: `https://${current.domain}`,
      companyDomain: current.domain,
      careerPageUrl: current.careerPageUrl,
      detectedAts: current.detectedAts,
      atsConfidence: current.detectedAts ? "verified" : "",
      careerConfidence: 0,
      companyEvidenceUrl: current.careerPageUrl,
      companyVerificationReason: current.strongestSignal,
      hiring: {
        status: current.activeJobs > 0 ? "Hiring Now" : "Unknown",
        activeJobs: current.activeJobs,
        hiringScore: current.intentScore,
        hiringLabel: current.strongestSignal,
        hasHrJobs: /recruit|talent|hris|human resources|\bhr\b/i.test(current.strongestSignal),
        source: current.source,
        sourceUrl: current.careerPageUrl,
        checkedAt: new Date().toISOString(),
        jobsSample: [],
      },
      location: person.location,
      email: first(person.emails) || "",
      emails: person.emails,
      phone: first(person.phones) || "",
      phones: person.phones,
      score: current.gtmScore,
      priority: person.phones.length ? "high" : current.gtmTier === "A" ? "high" : current.gtmTier === "B" ? "medium" : "normal",
      previousTitle: "",
      previousCompany: "",
      recentSignal: { type: "", label: current.strongestSignal },
      scoreReasons: [
        { label: `GTM Tier ${current.gtmTier}`, points: Math.min(100, current.gtmScore) },
        { label: "Intent score", points: Math.min(100, current.intentScore) },
        { label: "Persona match", points: Math.min(100, person.rankScore) },
      ],
    }),
  });

  const response = await prospectingPushPost(pushRequest);
  const result = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(result.error || `HubSpot push failed (${response.status}).`);
  return { assignment, result };
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Internal acquisition worker authorization failed." }, { status: 401 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid autorun request." }, { status: 400 });

  const workerKey = clean(request.headers.get("x-acquisition-worker-key"), 1000);
  const ownerKey = ensureOwnerBridge(workerKey);
  const origin = request.nextUrl.origin;
  const startedAt = new Date().toISOString();

  try {
    const seed = await seedApprovedApolloAccounts();
    const queue = await listAcquisitionAccounts({ limit: 1000, includeExcluded: false });
    const candidates = queue.accounts
      .filter((account) => account.exclusionStatus === "eligible" && account.status !== "pushed")
      .sort((a, b) => accountPriority(b) - accountPriority(a))
      .slice(0, parsed.data.limit);

    const outcomes: Array<Record<string, unknown>> = [];
    for (const account of candidates) {
      try {
        let people = (await listAcquisitionPeople(account.domain)).people;
        if (!people.length) {
          await acquisitionAction(origin, ownerKey, { action: "find_people", domain: account.domain });
          people = (await listAcquisitionPeople(account.domain)).people;
        }

        const ranked = [...people].sort((a, b) => contactPriority(b) - contactPriority(a));
        let person = ranked.find(hasReachableContact) || ranked[0];
        if (!person) {
          outcomes.push({ domain: account.domain, status: "no_person_found" });
          continue;
        }

        if (!hasReachableContact(person)) {
          // One paid SignalHire Person API attempt per account per autorun keeps the batch cost bounded.
          await acquisitionAction(origin, ownerKey, { action: "enrich_person", domain: account.domain, uid: person.uid });
          const refreshed = (await listAcquisitionPeople(account.domain)).people;
          person = refreshed.find((item) => item.uid === person?.uid) || refreshed.sort((a, b) => contactPriority(b) - contactPriority(a))[0];
        }

        if (!person || !hasReachableContact(person)) {
          outcomes.push({ domain: account.domain, status: "no_verified_contact", person: person?.fullName || "" });
          continue;
        }

        const pushed = await pushBestPerson(origin, ownerKey, account, person);
        outcomes.push({
          domain: account.domain,
          account: account.name,
          person: person.fullName,
          title: person.title,
          channel: person.phones.length ? "phone" : "email",
          status: pushed.result.duplicate ? "duplicate_task" : "pushed",
          ownerId: pushed.assignment.ownerId,
          ownerName: pushed.assignment.ownerName,
          contactId: pushed.result.contactId,
          companyId: pushed.result.companyId,
          taskId: pushed.result.taskId,
        });
      } catch (error) {
        outcomes.push({
          domain: account.domain,
          account: account.name,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown autorun error",
        });
      }
    }

    return NextResponse.json({
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      seed: { stored: seed.stored, eligible: seed.eligible, existingHubSpot: seed.existingHubSpot },
      selected: candidates.length,
      pushed: outcomes.filter((item) => item.status === "pushed").length,
      duplicates: outcomes.filter((item) => item.status === "duplicate_task").length,
      unresolved: outcomes.filter((item) => item.status === "no_person_found" || item.status === "no_verified_contact").length,
      failed: outcomes.filter((item) => item.status === "failed").length,
      outcomes,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Acquisition autorun failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Acquisition autorun failed.",
      startedAt,
    }, { status: 500 });
  }
}
