import { AI_SDR_BATCH_LIMIT, aiLeadKey, normalizePersonUrl, type AiLead } from "./ai-sdr-qualification.ts";
import { safeLinkedInProfileUrl } from "./linkedin-profile.ts";

function clean(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function identityKeys(lead: AiLead) {
  return [aiLeadKey(lead), safeLinkedInProfileUrl(lead.salesLeadUrl), `${lead.name.trim().toLowerCase()}::${lead.company.trim().toLowerCase()}`].filter(Boolean);
}

/** Read-only intake. Sales Nav identities are review candidates, not reveal approval. */
export function readSavedAiSdrLeads(source: unknown, existing: readonly AiLead[] = []) {
  const saved = Array.isArray(source) ? source : [];
  const seen = new Set(existing.flatMap(identityKeys));
  const room = Math.max(0, AI_SDR_BATCH_LIMIT - existing.length);
  const leads: AiLead[] = [];
  let invalid = 0, firstDegree = 0, duplicates = 0, overLimit = 0;
  for (const item of saved) {
    if (!item || typeof item !== "object" || Array.isArray(item)) { invalid++; continue; }
    const row = item as Record<string, unknown>;
    if (clean(row.connectionDegree, 30).toLowerCase() === "1st") { firstDegree++; continue; }
    const publicUrl = normalizePersonUrl(safeLinkedInProfileUrl(row.linkedinUrl));
    const sourceUrl = safeLinkedInProfileUrl(row.salesLeadUrl) || safeLinkedInProfileUrl(row.linkedinUrl);
    const salesLeadUrl = sourceUrl.includes("/sales/lead/") ? sourceUrl : "";
    const lead: AiLead = {
      name: clean(row.name, 220), title: clean(row.title, 320), company: clean(row.company, 320),
      location: clean(row.location, 320), linkedinUrl: publicUrl, salesLeadUrl,
      companyDomain: "", companyCountry: "", employeeCount: null,
      detectedAts: "", atsStatus: "unknown", atsEvidence: "", sector: "",
    };
    if (!lead.name || !lead.company || (!publicUrl && !salesLeadUrl)) { invalid++; continue; }
    const keys = identityKeys(lead);
    if (keys.some(key => seen.has(key))) { duplicates++; continue; }
    keys.forEach(key => seen.add(key));
    if (leads.length >= room) { overLimit++; continue; }
    leads.push(lead);
  }
  return { leads, total: saved.length, invalid, firstDegree, duplicates, overLimit, needsPublicProfile: leads.filter(lead => !lead.linkedinUrl).length };
}
