// Existing HubSpot mappings used by the prospecting and enrichment integrations.
export const CONTACT_LINKEDIN_PROPERTIES = [
  "gtm_linkedin_url", "linkedin_profile_link", "hs_linkedin_url", "linkedin_url",
] as const;

/** Only open an existing person profile, never a redirect, company or guessed identity. */
export function safeLinkedInProfileUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || raw.length > 1500 || /[\s\\]/.test(raw)) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return "";
    if (!/^(?:(?:www|[a-z]{2,3})\.)?linkedin\.com$/i.test(url.hostname)) return "";
    const path = url.pathname.replace(/\/+$/, "");
    if (!/^\/in\/[\p{L}\p{N}%._~-]+$/u.test(path) && !/^\/sales\/lead\/[A-Za-z0-9_,%-]+$/.test(path)) return "";
    // Encoded separators/control characters must not turn a profile into another route.
    const decoded = decodeURIComponent(path);
    if (/[\s\p{Cc}\\?#]/u.test(decoded) || decoded.split("/").length !== path.split("/").length) return "";
    return `https://www.linkedin.com${path}`;
  } catch {
    return "";
  }
}

export function contactLinkedInProfile(properties: Record<string, unknown> | undefined): string {
  if (!properties) return "";
  for (const field of CONTACT_LINKEDIN_PROPERTIES) {
    const url = safeLinkedInProfileUrl(properties[field]);
    if (url) return url;
  }
  return "";
}
