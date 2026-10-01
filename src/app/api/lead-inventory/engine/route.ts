import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as acquisitionAction } from "@/app/api/acquisition/route";
import { POST as pushAction } from "@/app/api/prospecting/push/route";
import { getAcquisitionAccount, listAcquisitionAccounts, listAcquisitionPeople, upsertAcquisitionAccounts, type AcquisitionPerson } from "@/lib/acquisition-data-api";
import { searchAll } from "@/lib/hubspot";
import { inventoryDomain } from "@/lib/lead-inventory-import";
import { compatibleCompanyIdentity } from "@/lib/company-dedupe";
import { saudiPolicyExcluded } from "@/lib/saudi-inventory-policy";
import { coverageData, coverageQueue, reserveInventoryOperation, finishInventoryOperation, recoverPreReveal } from "@/lib/saudi-coverage-store";
import { chooseInventorySdr, INVENTORY_SDR_IDS, learnedPriority, learnCoverage, personaFamily, productPersonas, suggestProduct } from "@/lib/saudi-coverage-learning";
import { syncSaudiCoverage } from "@/lib/saudi-coverage-sync";
import { enrichSaudiCompany } from "@/lib/saudi-company-enrichment";
import { researchInventoryAts } from "@/lib/saudi-ats-research";
import { findApolloInventoryPeople } from "@/lib/saudi-apollo-people";
import { atsProduct, SAUDI_DAILY_LIMIT, SAUDI_PIPELINE_PREFIX, usablePhone, recentActivityBoost } from "@/lib/saudi-ats-policy";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { originMatchesRequestHosts } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recover_pre_reveal") }),
  z.object({ action: z.literal("sync"), limit: z.number().int().min(1).max(50).default(10) }),
  z.object({ action: z.literal("run"), limit: z.number().int().min(1).max(5).default(1), confirmCredits: z.literal(true) }),
]);

export async function GET(request: NextRequest) {
  try {
    const data = await coverageData();
    const snapshots = [...new Map(data.snapshots.sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)).map((s) => [s.companyId, s])).values()];
    return NextResponse.json({ version: "saudi-coverage-v1", policy: { minimumEmployees: 200, priorityEmployees: 250, dailyPersonAttempts: SAUDI_DAILY_LIMIT, dailyCompanies: SAUDI_DAILY_LIMIT, owners: ["Marita", "Daniel"] },
      coverage: { checked: snapshots.length, attempted: snapshots.filter((s) => s.attempted).length, connected: snapshots.filter((s) => s.connected).length,
        meetingsHeld: snapshots.filter((s) => s.meetingHeld).length, both: snapshots.filter((s) => s.connected && s.meetingHeld).length,
        futureTask: snapshots.filter((s) => s.futureTask).length, lastCheckedAt: snapshots.map((s) => s.checkedAt).sort().at(-1) || null },
      model: learnCoverage(data.observations), operations: data.operations, ...(sdrAdminAuthorized(request) ? { reviews: data.reviews } : {}),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Coverage unavailable" }, { status: 503 }); }
}

async function internalAction(request: NextRequest, path: string, body: unknown, handler: (request: NextRequest) => Promise<Response>) {
  const headers = new Headers(request.headers); headers.set("Content-Type", "application/json");
  // The outer request has already passed the same-origin gate.
  headers.set("origin", request.nextUrl.origin);
  const response = await handler(new NextRequest(new URL(path, request.url), { method: "POST", headers, body: JSON.stringify(body) }));
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Inventory action failed (${response.status})`);
  return result;
}

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Admin authorization required" }, { status: 401 });
  if (!originMatchesRequestHosts({ origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), requestHost: request.nextUrl.host })) return NextResponse.json({ error: "Cross-site action rejected" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid engine action" }, { status: 400 });
  try {
    if (parsed.data.action === "sync") return NextResponse.json(await syncSaudiCoverage(parsed.data.limit));
    if (parsed.data.action === "recover_pre_reveal") {
      let recovered = 0;
      const data = await coverageData();
      for (const review of data.reviews.filter((r) => r.kind === "pipeline").slice(0, 10)) {
        const account = await getAcquisitionAccount(review.key.replace(/^pipeline:/, ""));
        if (!account?.evidence.saudi200 || !account.evidence.companyEnrichedAt || account.hubspotCompanyId || account.country !== "Saudi Arabia" || account.employeeCount < 200 || saudiPolicyExcluded(account.domain, `${account.name} ${account.industry}`)) continue;
        if (!(await recoverPreReveal(account.domain)).recovered) continue;
        await upsertAcquisitionAccounts([{ ...account, exclusionStatus: "eligible", exclusionReason: "", status: "qualified", evidence: { ...account.evidence, preRevealRetryAuthorized: new Date().toISOString() } }]);
        recovered++;
      }
      return NextResponse.json({ recovered });
    }
    const data = await coverageData(), model = learnCoverage(data.observations);
    const queue = await coverageQueue("work", 100);
    const candidates = [];
    const accounts = await listAcquisitionAccounts({ allSources: true, saudi200: true, crmPresence: "new", includeExcluded: true, limit: 1000 });
    for (let offset = 1000; offset < (accounts.pagination?.filteredTotal || 0); offset += 1000) {
      accounts.accounts.push(...(await listAcquisitionAccounts({ allSources: true, saudi200: true, crmPresence: "new", includeExcluded: true, limit: 1000, offset })).accounts);
    }
    const queued = new Set(queue.domains);
    for (const account of accounts.accounts.filter((a) => queued.has(a.domain))) {
      const product = account.evidence.productReviewed ? (account.evidence.businessLine === "Evalufy" ? "Evalufy" : "Talentera") : suggestProduct(account.industry, String(account.evidence.sourceText || account.name));
      const personas = productPersonas(product, `${account.industry} ${account.name}`, account.employeeCount);
      const learned = learnedPriority(account.gtmScore, product, account.industry, account.employeeCount, personas.primary, model);
      candidates.push({ account, product, personas, learned });
    }
    candidates.sort((a, b) => recentActivityBoost(b.account.evidence.recentActivity) - recentActivityBoost(a.account.evidence.recentActivity) || Number(b.account.employeeCount >= 250) - Number(a.account.employeeCount >= 250) || b.learned.score - a.learned.score);
    const loads: Record<string, number> = {};
    for (const owner of INVENTORY_SDR_IDS) {
      loads[owner] = (await searchAll("tasks", ["hs_task_status"], [{ propertyName: "hubspot_owner_id", operator: "EQ", value: owner }, { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" }])).length;
    }
    const results: { domain: string; status: string; ownerId?: string; error?: string }[] = [];
    for (const candidate of candidates.slice(0, parsed.data.limit)) {
      let { account, product, personas, learned } = candidate;
      const operationKey = `${SAUDI_PIPELINE_PREFIX}${account.domain}`;
      const reservation = await reserveInventoryOperation(operationKey, "pipeline", SAUDI_DAILY_LIMIT);
      if (!reservation.reserved) { results.push({ domain: account.domain, status: reservation.state }); continue; }
      try {
        if (!account.evidence.saudi200 || account.country !== "Saudi Arabia" || (account.employeeCount > 0 && account.employeeCount < 200) || saudiPolicyExcluded(account.domain, `${account.name} ${account.industry}`)) throw new Error("Company is outside the Saudi 200+ commercial policy");
        inventoryDomain(account.domain);
        // Fresh aliases + name checks before any provider spend. No existing CRM
        // company is recycled through this acquisition pipeline.
        const aliases = [account.domain, `www.${account.domain}`, `https://${account.domain}`, `http://${account.domain}`, `https://www.${account.domain}`, `http://www.${account.domain}`];
        const existing = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "IN", values: aliases }]);
        const names = await searchAll("companies", ["name", "domain"], [{ propertyName: "name", operator: "EQ", value: account.name }]);
        if (existing.length || names.length) {
          await upsertAcquisitionAccounts([{ ...account, status: "existing_hubspot", exclusionStatus: "excluded", exclusionReason: "Already exists in HubSpot", hubspotCompanyId: (existing[0] || names[0]).id }]);
          throw new Error("Company already exists in HubSpot; excluded before enrichment");
        }
        const researched = await researchInventoryAts(account);
        account = researched.account;
        const routedProduct = atsProduct(researched.ats);
        if (!routedProduct) throw new Error("ATS result is unknown; research required before routing or person spend");
        account = await enrichSaudiCompany(account);
        if (account.country !== "Saudi Arabia" || account.employeeCount < 200 || saudiPolicyExcluded(account.domain, `${account.name} ${account.industry}`)) {
          await upsertAcquisitionAccounts([{ ...account, exclusionStatus: "excluded", exclusionReason: "Enriched company profile is outside the Saudi 200+ commercial policy", status: "excluded" }]);
          throw new Error("Enriched company profile is outside the Saudi 200+ policy; no person reveal");
        }
        product = routedProduct;
        const ownerId = chooseInventorySdr(loads, product, account.assignedOwnerId);
        if (ownerId !== (product === "Evalufy" ? "37624223" : "31644369")) throw new Error("Existing SDR assignment conflicts with verified ATS routing; review required");
        personas = productPersonas(product, `${account.industry} ${account.name}`, account.employeeCount);
        learned = learnedPriority(account.gtmScore, product, account.industry, account.employeeCount, personas.primary, model);
        const updated = { ...account, exclusionStatus: "eligible" as const, exclusionReason: "Saudi 200+ identity and ATS routing verified", primaryPersona: personas.primary, secondaryPersona: personas.secondary, evidence: { ...account.evidence, businessLine: product, productReason: researched.ats.reason, atsRoutingPolicy: "ats-v2", priorityModel: model.method, learnedLift: learned.lift } };
        await upsertAcquisitionAccounts([updated]);
        let people = (await listAcquisitionPeople(account.domain)).people;
        if (!people.some(p => p.enrichmentStatus === "enriched" && p.phones.some(usablePhone))) {
          await internalAction(request, "/api/acquisition", { action: "find_people", domain: account.domain }, acquisitionAction);
          people = (await listAcquisitionPeople(account.domain)).people;
        }
        const matches = (p: AcquisitionPerson) => personaFamily(p.title) !== "Other / unknown" && p.rankScore >= 55 && compatibleCompanyIdentity({ requestedName: account.name, requestedDomain: "", existingName: p.currentCompany, existingDomain: "" });
        if (!people.some(p => matches(p) && (p.enrichmentStatus !== "enriched" || p.phones.some(usablePhone)))) {
          await findApolloInventoryPeople(updated);
          people = (await listAcquisitionPeople(account.domain)).people;
        }
        let eligible = people.filter((p) => personaFamily(p.title) !== "Other / unknown" && p.rankScore >= 55 && compatibleCompanyIdentity({ requestedName: account.name, requestedDomain: "", existingName: p.currentCompany, existingDomain: "" }));
        eligible.sort((a, b) => {
          const aRank = learnedPriority(a.rankScore, product, account.industry, account.employeeCount, a.title, model).score;
          const bRank = learnedPriority(b.rankScore, product, account.industry, account.employeeCount, b.title, model).score;
          return Number(b.enrichmentStatus === "enriched" && b.phones.length > 0) - Number(a.enrichmentStatus === "enriched" && a.phones.length > 0) || bRank - aRank;
        });
        let person: AcquisitionPerson | undefined;
        const tried = new Set<string>();
        let reveals = 0;
        for (let sourcePass = 0; sourcePass < 2 && !person; sourcePass++) {
          for (const selected of eligible) {
            if (tried.has(selected.uid)) continue;
            tried.add(selected.uid);
            let enrichedPerson = selected;
            if (selected.enrichmentStatus !== "enriched") {
              if (reveals >= 3) break;
              reveals++;
              try {
                const enriched = await internalAction(request, "/api/acquisition", { action: "enrich_person", domain: account.domain, uid: selected.uid }, acquisitionAction);
                enrichedPerson = enriched.person as AcquisitionPerson;
              } catch { continue; } // Reservation retains uncertain outcomes; try another person, never retry this reveal.
            }
            if (matches(enrichedPerson) && enrichedPerson.phones.some(usablePhone) && enrichedPerson.meta.verifiedCurrentCompany) { person = enrichedPerson; break; }
          }
          if (!person && sourcePass === 0 && reveals < 3) {
            await findApolloInventoryPeople(updated);
            eligible = (await listAcquisitionPeople(account.domain)).people.filter(matches).sort((a,b) => b.rankScore-a.rankScore);
          }
        }
        if (!person) throw new Error(eligible.length ? "Phone or current-employer verification missing; no CRM push" : "No verified matching persona found; review the company/persona before retrying");
        const assigned = await internalAction(request, "/api/acquisition", { action: "assign", domain: account.domain, ownerId }, acquisitionAction);
        if (assigned.assignment.ownerId !== ownerId) throw new Error("Assignment changed concurrently; review before pushing");
        const result = await internalAction(request, "/api/prospecting/push", {
          assignmentMode: "acquisition", inventoryBusinessLine: product, ownerId, ownerName: assigned.assignment.ownerName,
          source: `Lead Inventory · ${product} · Saudi coverage engine`, signalHireUid: person.uid,
          fullName: person.fullName, title: person.title, linkedinUrl: person.linkedinUrl, location: person.location,
          company: account.name, companyDomain: account.domain, companyWebsite: `https://${account.domain}`,
          careerPageUrl: researched.ats.careerUrl, detectedAts: researched.ats.vendor, atsConfidence: "high",
          companyEvidenceUrl: researched.ats.evidenceUrl, companyVerificationReason: researched.ats.reason,
          emails: person.emails, email: person.emails[0] || "", phones: person.phones, phone: person.phones[0],
          score: learned.score, priority: "high", recentSignal: { type: "ats_routing", label: researched.ats.reason },
        }, pushAction);
        await finishInventoryOperation(operationKey, "completed", { contactId: result.contactId, taskId: result.taskId, ownerId });
        loads[ownerId]++;
        results.push({ domain: account.domain, status: result.duplicate ? "existing_task" : "pushed", ownerId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Inventory processing failed";
        await finishInventoryOperation(operationKey, "review", { error: message });
        results.push({ domain: account.domain, status: "review", error: message });
      }
    }
    return NextResponse.json({ modelMode: model.mode, processed: results.length, pushed: results.filter((r) => r.status === "pushed").length, results });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Engine failed" }, { status: 502 }); }
}
