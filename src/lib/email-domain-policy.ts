function clean(value: unknown, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max).toLowerCase();
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
]);

export function normalizeCompanyDomain(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0];
  }
}

export function emailDomain(value: unknown) {
  const email = clean(value, 320);
  return email.split("@")[1] || "";
}

export function domainsMatch(left: unknown, right: unknown) {
  const a = normalizeCompanyDomain(left);
  const b = normalizeCompanyDomain(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function emailMatchesCompanyDomain(email: unknown, companyDomain: unknown) {
  return domainsMatch(emailDomain(email), companyDomain);
}

export function isPersonalEmail(value: unknown) {
  return PERSONAL_EMAIL_DOMAINS.has(emailDomain(value));
}
