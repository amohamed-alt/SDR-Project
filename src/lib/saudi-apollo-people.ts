import { type AcquisitionAccount, type AcquisitionPerson, listAcquisitionPeople, upsertAcquisitionPeople } from "@/lib/acquisition-data-api";
import { rankAcquisitionCandidates } from "@/lib/acquisition-routing";
import { finishInventoryOperation, reserveInventoryOperation } from "@/lib/saudi-coverage-store";
import { SAUDI_DAILY_LIMIT, usablePhone } from "@/lib/saudi-ats-policy";
import { inventoryDomain } from "@/lib/lead-inventory-import";

// Free domain-based search is the fallback when company-name search misses the
// current team. Identity matches are durable, separately budgeted paid calls.
export async function findApolloInventoryPeople(account: AcquisitionAccount) {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return [];
  const titles = /admission|enrol|registrar/i.test(account.primaryPersona)
    ? ["admissions", "assessment", "examinations", "registrar", "enrollment"]
    : ["talent acquisition", "recruitment", "human resources", "HR manager", "HR director", "people director", "assessment"];
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q_organization_domains_list: [account.domain], person_titles: titles, per_page: 25, page: 1 }),
    cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Apollo people search failed (${response.status})`);
  const payload = await response.json();
  const ranked = rankAcquisitionCandidates((payload.people || []).map((p: Record<string, unknown>) => ({
    uid: String(p.id || ""), fullName: String(p.first_name || ""), title: String(p.title || ""),
    currentCompany: String((p.organization as Record<string, unknown> | undefined)?.name || ""), location: "",
  })), { accountName: account.name, country: account.country, primaryPersona: account.primaryPersona, secondaryPersona: account.secondaryPersona });
  const found: AcquisitionPerson[] = [];
  for (const candidate of ranked.filter(p => p.score >= 55 && /^[a-f0-9]{24}$/.test(p.uid)).slice(0, 3)) {
    const operationKey = `person_identity:${candidate.uid}`;
    const reservation = await reserveInventoryOperation(operationKey, "person_identity", SAUDI_DAILY_LIMIT);
    if (!reservation.reserved) {
      if (reservation.state === "budget_exhausted") break;
      const saved = (await listAcquisitionPeople(account.domain)).people.find(p => p.meta.apolloPersonId === candidate.uid);
      if (saved) found.push(saved);
      continue;
    }
    try {
      const query = new URLSearchParams({ id: candidate.uid, reveal_personal_emails: "false", reveal_phone_number: "false" });
      const match = await fetch(`https://api.apollo.io/api/v1/people/match?${query}`, {
        method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000),
      });
      if (!match.ok) throw new Error(`Apollo person identity failed (${match.status})`);
      const { person } = await match.json();
      if (!person?.name || !/^https:\/\/(www\.)?linkedin\.com\/in\//.test(person.linkedin_url || "") || inventoryDomain(String(person.organization?.primary_domain || person.organization?.website_url || "")) !== account.domain) throw new Error("Apollo person current company identity is unverified");
      const linkedinUrl = String(person.linkedin_url).split("?")[0].replace(/\/$/, "");
      const existing = (await listAcquisitionPeople(account.domain)).people.find(p => p.linkedinUrl.replace(/\/$/, "") === linkedinUrl);
      const score = rankAcquisitionCandidates([{ uid: linkedinUrl, fullName: person.name, title: person.title || "", currentCompany: person.organization.name || account.name,
        location: [person.city, person.country].filter(Boolean).join(", "), linkedinUrl }], { accountName: account.name, country: account.country, primaryPersona: account.primaryPersona, secondaryPersona: account.secondaryPersona })[0];
      // No phone reveal is requested. Reuse any person-level numbers already
      // available on the matched profile; never substitute the company switchboard.
      const phones = [...new Set<string>((person.phone_numbers || []).map((p: { sanitized_number?: string; raw_number?: string }) => String(p.sanitized_number || p.raw_number || "")).filter(usablePhone))];
      const saved: AcquisitionPerson = existing?.enrichmentStatus === "enriched" ? existing : {
        uid: existing?.uid || linkedinUrl, accountDomain: account.domain, fullName: score.fullName, title: score.title, currentCompany: score.currentCompany,
        location: score.location, linkedinUrl, rankScore: score.score, fitReason: score.reason, emails: person.email ? [String(person.email)] : [], phones,
        enrichmentStatus: phones.length ? "enriched" : "search_only", selected: false,
        meta: { ...existing?.meta, provider: "Apollo identity + SignalHire phone", apolloPersonId: candidate.uid, verifiedCurrentCompany: true },
      };
      await upsertAcquisitionPeople([saved]);
      await finishInventoryOperation(operationKey, "completed", { uid: saved.uid });
      found.push(saved);
    } catch (error) {
      await finishInventoryOperation(operationKey, "review", { error: error instanceof Error ? error.message : "Identity match uncertain" });
    }
  }
  return found;
}
