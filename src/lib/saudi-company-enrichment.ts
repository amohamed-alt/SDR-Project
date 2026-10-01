import { type AcquisitionAccount, upsertAcquisitionAccounts } from "@/lib/acquisition-data-api";
import { reserveInventoryOperation, finishInventoryOperation } from "@/lib/saudi-coverage-store";
import { inventoryDomain } from "@/lib/lead-inventory-import";

// Company details are fetched only for a company that already passed a fresh
// CRM exclusion check. Apollo documents one credit per organization enrichment.
export async function enrichSaudiCompany(account: AcquisitionAccount): Promise<AcquisitionAccount> {
  if (account.evidence.companyEnrichedAt || (account.employeeCount >= 200 && account.industry && !/^(target industry|unknown)$/i.test(account.industry))) return account;
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error("Apollo company enrichment is not configured");
  const operationKey = `company_enrichment:${account.domain}`;
  const reservation = await reserveInventoryOperation(operationKey, "company_enrichment", 10);
  if (!reservation.reserved) throw new Error(`Company enrichment is ${reservation.state}; review the retained attempt before another charge`);
  try {
    const query = new URLSearchParams({ domain: account.domain, name: account.name });
    const response = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?${query}`, { headers: { "x-api-key": key, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Apollo company enrichment failed (${response.status}); no automatic retry`);
    const payload = await response.json() as { organization?: Record<string, unknown> };
    const org = payload.organization;
    if (!org || inventoryDomain(String(org.primary_domain || org.website_url || "")) !== account.domain) throw new Error("Apollo returned an ambiguous company identity; review required");
    const count = Number(org.estimated_num_employees || 0);
    const country = String(org.country || account.country);
    const updated: AcquisitionAccount = { ...account, employeeCount: Number.isSafeInteger(count) && count > 0 && count <= 10_000_000 ? count : account.employeeCount,
      industry: String(org.industry || account.industry).slice(0, 300), country,
      evidence: { ...account.evidence, companyEnrichedAt: new Date().toISOString(), companyDetailsSource: "Apollo organization enrichment",
        sourceText: String(org.short_description || org.seo_description || account.evidence.sourceText || "").slice(0, 3000), companyLinkedIn: String(org.linkedin_url || account.evidence.companyLinkedIn || "").slice(0, 2000) } };
    await upsertAcquisitionAccounts([updated]);
    await finishInventoryOperation(operationKey, "completed", { domain: updated.domain, employeeCount: updated.employeeCount, industry: updated.industry });
    return updated;
  } catch (error) {
    await finishInventoryOperation(operationKey, "review", { error: error instanceof Error ? error.message : "Company enrichment uncertain" }).catch(() => undefined);
    throw error;
  }
}
