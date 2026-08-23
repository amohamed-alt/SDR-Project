function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizedCompanyName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\b(?:limited|ltd|llc|incorporated|inc|company|co|corp|corporation|group|holding|holdings)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedCompanyDomain(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

export function compatibleCompanyIdentity(input: {
  requestedName: string;
  requestedDomain: string;
  existingName: string;
  existingDomain: string;
}) {
  const requestedName = normalizedCompanyName(input.requestedName);
  const existingName = normalizedCompanyName(input.existingName);
  if (!requestedName || !existingName || requestedName !== existingName) return false;

  const requestedDomain = normalizedCompanyDomain(input.requestedDomain);
  const existingDomain = normalizedCompanyDomain(input.existingDomain);
  return !requestedDomain || !existingDomain || requestedDomain === existingDomain;
}
