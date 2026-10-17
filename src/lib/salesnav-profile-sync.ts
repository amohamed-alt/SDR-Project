/** Identity comes from a rendered person profile, never a guessed Sales Nav URL. */
export type CapturedProfile = { name: string; salesLeadUrl: string; linkedinUrl: string; title?: string; company?: string; location?: string };

export function publicPersonProfile(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/^(www\.)?linkedin\.com$/i.test(url.hostname) || !/^\/in\/[^/?#]+\/?$/.test(url.pathname)) return "";
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
  } catch { return ""; }
}

/** Saved URLs also need a free check when the dashboard is opened after capture. */
export function shouldCheckCapturedProfile(
  lead: CapturedProfile,
  previous?: { lead: CapturedProfile; stage: string },
): boolean {
  if (!publicPersonProfile(lead.linkedinUrl) || previous?.stage === "pushed") return false;
  return !previous || ["pending", "awaiting-profile", "needs-profile"].includes(previous.stage)
    || JSON.stringify(previous.lead) !== JSON.stringify(lead);
}

function salesPersonKey(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/^(www\.)?linkedin\.com$/i.test(url.hostname)) return "";
    return url.pathname.match(/^\/sales\/lead\/([^/,?#]+)/)?.[1] || "";
  } catch { return ""; }
}
function nameKey(raw: string) { return raw.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase(); }

export function mergeCapturedProfile<T extends CapturedProfile>(leads: T[], profile: CapturedProfile): { leads: T[]; synced: boolean } {
  const linkedinUrl = publicPersonProfile(profile.linkedinUrl);
  const salesKey = salesPersonKey(profile.salesLeadUrl);
  if (!linkedinUrl || !salesKey || !nameKey(profile.name)) return { leads, synced: false };
  const index = leads.findIndex(lead => salesPersonKey(lead.salesLeadUrl) === salesKey && nameKey(lead.name) === nameKey(profile.name));
  if (index < 0) return { leads, synced: false };
  const existing = leads[index];
  const previousUrl = publicPersonProfile(existing.linkedinUrl);
  if (previousUrl && previousUrl !== linkedinUrl) throw new Error("Saved person has a different public LinkedIn profile. Review the identity before syncing.");
  const next = [...leads];
  next[index] = { ...existing, linkedinUrl, title: profile.title || existing.title, company: profile.company || existing.company, location: profile.location || existing.location };
  return { leads: next, synced: true };
}
