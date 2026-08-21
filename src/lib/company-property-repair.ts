export const REPAIRABLE_COMPANY_PROPERTIES = [
  "domain",
  "company_website",
  "career_page_url",
  "detected_ats",
  "ats_status",
  "ats_confidence",
  "ats_evidence_url",
  "ats_evidence_reason",
  "career_portal_type",
] as const;

export type RepairableCompanyProperty = typeof REPAIRABLE_COMPANY_PROPERTIES[number];
export type RepairDisposition = "same" | "fill" | "conflict" | "missing_property" | "no_suggestion";

export type PropertyRepair = {
  property: RepairableCompanyProperty;
  currentValue: string;
  suggestedValue: string;
  disposition: RepairDisposition;
  confidence: number;
  evidence: string;
  canAutoApply: boolean;
};

export function normalizeCompanyDomain(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return input.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

function normalizeComparable(property: RepairableCompanyProperty, value: string) {
  const input = String(value || "").trim();
  if (property === "domain") return normalizeCompanyDomain(input);
  if (["company_website", "career_page_url", "ats_evidence_url"].includes(property)) {
    if (!input) return "";
    try {
      const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
      parsed.hash = "";
      if (parsed.pathname === "/") parsed.pathname = "";
      return parsed.toString().replace(/\/$/, "").toLowerCase();
    } catch {
      return input.replace(/\/$/, "").toLowerCase();
    }
  }
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildCompanyPropertyRepairs(input: {
  current: Record<string, unknown>;
  suggested: Partial<Record<RepairableCompanyProperty, string>>;
  confidence: number;
  evidence: string;
  availableProperties?: Set<string>;
}) {
  return REPAIRABLE_COMPANY_PROPERTIES.map<PropertyRepair>((property) => {
    const currentValue = String(input.current[property] || "").trim();
    const suggestedValue = String(input.suggested[property] || "").trim();
    const propertyExists = !input.availableProperties || input.availableProperties.has(property);
    if (!propertyExists) {
      return { property, currentValue, suggestedValue, disposition: "missing_property", confidence: input.confidence, evidence: input.evidence, canAutoApply: false };
    }
    if (!suggestedValue) {
      return { property, currentValue, suggestedValue, disposition: "no_suggestion", confidence: input.confidence, evidence: input.evidence, canAutoApply: false };
    }
    if (normalizeComparable(property, currentValue) === normalizeComparable(property, suggestedValue)) {
      return { property, currentValue, suggestedValue, disposition: "same", confidence: input.confidence, evidence: input.evidence, canAutoApply: false };
    }
    if (!currentValue) {
      return { property, currentValue, suggestedValue, disposition: "fill", confidence: input.confidence, evidence: input.evidence, canAutoApply: input.confidence >= 90 };
    }
    return { property, currentValue, suggestedValue, disposition: "conflict", confidence: input.confidence, evidence: input.evidence, canAutoApply: false };
  });
}

export function propertiesToApply(repairs: PropertyRepair[], overwriteConflicts = false) {
  const output: Record<string, string> = {};
  for (const repair of repairs) {
    if (repair.disposition === "fill" && repair.canAutoApply) output[repair.property] = repair.suggestedValue;
    if (overwriteConflicts && repair.disposition === "conflict" && repair.confidence >= 95 && repair.evidence) {
      output[repair.property] = repair.suggestedValue;
    }
  }
  return output;
}
