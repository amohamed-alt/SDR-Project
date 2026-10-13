import { normalizePersonUrl } from "./ai-sdr-qualification.ts";

type LeadIdentity = { name?: string; salesLeadUrl?: string; linkedinUrl?: string };
type CachedIdentity = { aliases?: string[]; linkedinUrl?: string; cachedProspect?: Record<string, unknown> };

function nameKey(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() : "";
}

/** No fuzzy names or inferred nicknames: discrepancies require manual review. */
export function salesNavNameMismatch(lead: LeadIdentity, prospect: Record<string, unknown>): string {
  if (!lead.salesLeadUrl?.trim()) return "";
  const selectedName = nameKey(lead.name);
  // Preserve older ledger records while never treating the display-name fallback
  // on a new provider result as independently verified identity.
  const revealedName = nameKey(Object.hasOwn(prospect, "providerFullName") ? prospect.providerFullName : prospect.fullName);
  return selectedName && revealedName && selectedName === revealedName ? ""
    : "Revealed name differs from the selected Sales Navigator person or is missing. Review the public profile and provider identity manually before continuing.";
}

/** A Sales Nav/name alias hit is not proof that a newly edited public URL matches. */
export function cachedSalesNavIdentityMismatch(requestedUrl: string, cached: CachedIdentity): string {
  const requested = normalizePersonUrl(requestedUrl);
  const profiles = [
    ...(cached.aliases || []).filter(alias => alias.startsWith("li:")).map(alias => alias.slice(3)),
    cached.linkedinUrl,
    cached.cachedProspect?.linkedinUrl,
  ].filter(value => typeof value === "string" && value.trim());
  if (!requested || !profiles.length || profiles.some(value => normalizePersonUrl(value) !== requested)) {
    return "A previous reveal is linked to a different or unverified public LinkedIn profile. Manual identity review is required; no new contact credits were used.";
  }
  return "";
}
