const THIRD_PARTY_COMPANY_DOMAINS = [
  "wuzzuf.net",
  "wuzzuf.com",
  "indeed.com",
  "glassdoor.com",
  "bayt.com",
  "naukrigulf.com",
  "gulftalent.com",
  "laimoon.com",
  "jobzella.com",
  "drjobpro.com",
  "grabjobs.co",
  "careerjet.com",
  "monster.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "crunchbase.com",
  "zoominfo.com",
  "rocketreach.co",
  "signalhire.com",
  "wikipedia.org",
] as const;

const GENERIC_COMPANY_WORDS = new Set([
  "group",
  "company",
  "companies",
  "holding",
  "holdings",
  "limited",
  "ltd",
  "llc",
  "inc",
  "corp",
  "corporation",
  "plc",
  "saudi",
  "arabia",
  "ksa",
  "egypt",
  "uae",
  "the",
  "and",
  "for",
]);

export function companyHost(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
}

function companyBrandTokens(companyName: string) {
  return String(companyName || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_COMPANY_WORDS.has(word));
}

function platformMatchesCompany(platformDomain: string, companyName: string) {
  const stem = platformDomain.split(".")[0].replace(/[^a-z0-9]/g, "");
  if (stem.length < 3) return false;
  return companyBrandTokens(companyName).some((token) => {
    const compact = token.replace(/[^a-z0-9]/g, "");
    return compact === stem || compact.includes(stem) || stem.includes(compact);
  });
}

export function isThirdPartyCompanyDomain(raw: string, companyName = "") {
  const host = companyHost(raw);
  if (!host) return false;

  for (const blocked of THIRD_PARTY_COMPANY_DOMAINS) {
    if (host !== blocked && !host.endsWith(`.${blocked}`)) continue;
    // A platform can itself be the target account (for example Bayt or Wuzzuf).
    // Only allow that exception when the target company name clearly matches the platform brand.
    if (platformMatchesCompany(blocked, companyName)) return false;
    return true;
  }

  return false;
}

export function safeCompanyWebsite(raw: string, companyName = "") {
  const value = String(raw || "").trim();
  if (!value || value.toLowerCase() === "n/a") return "";
  if (isThirdPartyCompanyDomain(value, companyName)) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function safeCompanyDomain(raw: string, companyName = "") {
  if (isThirdPartyCompanyDomain(raw, companyName)) return "";
  return companyHost(raw);
}

export const thirdPartyCompanyDomains = [...THIRD_PARTY_COMPANY_DOMAINS];
