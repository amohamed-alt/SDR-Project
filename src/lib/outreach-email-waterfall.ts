import fs from "node:fs/promises";
import path from "node:path";

const MILLIONVERIFIER_URL = "https://api.millionverifier.com/api/v3/";
const SIGNALHIRE_URL = "https://www.signalhire.com/api/v1/candidate/search";
const HUBSPOT_API = "https://api.hubapi.com";
const CACHE_PATH = process.env.MILLIONVERIFIER_CACHE_PATH || "/app/data/millionverifier-cache.json";
const CACHE_TTL_MS: Record<VerificationStatus, number> = {
  valid: 14 * 86_400_000,
  catch_all: 24 * 60 * 60 * 1000,
  invalid: 30 * 86_400_000,
  unknown: 24 * 60 * 60 * 1000,
};
const MAX_SIGNALHIRE_EMAILS_TO_VERIFY = 3;

type VerificationStatus = "valid" | "catch_all" | "invalid" | "unknown";

type CacheEntry = {
  email: string;
  status: VerificationStatus;
  checkedAt: string;
  quality: string;
  subresult: string;
};

type CacheStore = { version: 1; entries: CacheEntry[] };

type SignalHireContact = { type?: string; value?: string; rating?: number; subType?: string | null };
type SignalHireCandidate = {
  uid?: string;
  fullName?: string;
  contacts?: SignalHireContact[];
  experience?: Array<{ company?: string | null; website?: string | null; current?: boolean }>;
};
type SignalHireResult = { status?: string; candidate?: SignalHireCandidate };

export type OutreachEmailCandidate = {
  contactId: string;
  email: string;
  linkedinUrl: string;
  fullName: string;
  companyName: string;
  domain: string;
  blockReason?: string;
};

export type OutreachEmailWaterfallResult = {
  target: number;
  considered: number;
  millionVerifierChecks: number;
  millionVerifierCacheHits: number;
  signalHireLookups: number;
  replacements: number;
  validCurrent: number;
  noValidEmail: number;
  millionVerifierCreditsLeft: number | null;
  signalHireCreditsLeft: number | null;
  sendableEmails: string[];
};

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizedEmail(value: unknown) {
  return clean(value, 320).toLowerCase();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizeDomain(value: unknown) {
  const raw = clean(value, 500).toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function normalizeCompany(value: unknown) {
  return clean(value, 300)
    .toLowerCase()
    .replace(/\b(?:company|co|ltd|limited|llc|inc|incorporated|group|holding|holdings|saudi|ksa)\b/g, " ")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyMatches(candidate: SignalHireCandidate, expectedName: string, expectedDomain: string) {
  const current = candidate.experience?.find((item) => item.current) || candidate.experience?.[0];
  if (!current) return false;
  const actualDomain = normalizeDomain(current.website);
  const targetDomain = normalizeDomain(expectedDomain);
  if (actualDomain && targetDomain && (actualDomain === targetDomain || actualDomain.endsWith(`.${targetDomain}`) || targetDomain.endsWith(`.${actualDomain}`))) return true;

  const actual = normalizeCompany(current.company);
  const expected = normalizeCompany(expectedName);
  if (!actual || !expected) return false;
  if (actual === expected || actual.includes(expected) || expected.includes(actual)) return true;
  const a = new Set(actual.split(" ").filter((token) => token.length >= 4));
  const b = new Set(expected.split(" ").filter((token) => token.length >= 4));
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap >= 2;
}

function mapMillionVerifierResult(result: unknown): VerificationStatus {
  const value = clean(result, 80).toLowerCase();
  if (value === "ok") return "valid";
  if (value === "catch_all" || value === "catch-all") return "catch_all";
  if (value === "invalid" || value === "disposable") return "invalid";
  return "unknown";
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(/* turbopackIgnore: true */ CACHE_PATH, "utf8")) as CacheStore;
  } catch {
    return { version: 1 as const, entries: [] };
  }
}

async function writeCache(store: CacheStore) {
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(CACHE_PATH), { recursive: true });
  const tmp = `${CACHE_PATH}.tmp-${process.pid}`;
  await fs.writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  await fs.rename(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ CACHE_PATH);
}

function freshEntry(entry: CacheEntry | undefined) {
  return Boolean(entry && Date.now() - new Date(entry.checkedAt).getTime() < CACHE_TTL_MS[entry.status]);
}

async function verifyEmail(email: string, apiKey: string, store: CacheStore) {
  const normalized = normalizedEmail(email);
  const existing = store.entries.find((entry) => entry.email === normalized);
  if (freshEntry(existing)) return { entry: existing!, cacheHit: true, creditsLeft: null as number | null };

  const query = new URLSearchParams({ api: apiKey, email: normalized, timeout: "10" });
  const response = await fetch(`${MILLIONVERIFIER_URL}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || clean(payload.error)) throw new Error(`MillionVerifier failed (${response.status}): ${clean(payload.error || "Unknown error", 300)}`);
  const entry: CacheEntry = {
    email: normalized,
    status: mapMillionVerifierResult(payload.result),
    checkedAt: new Date().toISOString(),
    quality: clean(payload.quality, 80),
    subresult: clean(payload.subresult, 120),
  };
  const byEmail = new Map(store.entries.map((item) => [item.email, item]));
  byEmail.set(normalized, entry);
  store.entries = [...byEmail.values()].slice(-50_000);
  await writeCache(store);
  const credits = Number(payload.credits);
  return { entry, cacheHit: false, creditsLeft: Number.isFinite(credits) ? credits : null };
}

async function updateHubSpotContact(contactId: string, properties: Record<string, string>) {
  const token = clean(process.env.HUBSPOT_PRIVATE_APP_TOKEN, 8_000);
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  const response = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HubSpot email update failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
}

function dateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function rankedSignalHireEmails(candidate: SignalHireCandidate, originalEmail: string) {
  const original = normalizedEmail(originalEmail);
  return (candidate.contacts || [])
    .filter((item) => item.type === "email" && isEmail(normalizedEmail(item.value)) && normalizedEmail(item.value) !== original && Number(item.rating || 0) >= 70)
    .sort((a, b) => {
      const aWork = a.subType === "work" ? 1 : 0;
      const bWork = b.subType === "work" ? 1 : 0;
      if (aWork !== bWork) return bWork - aWork;
      return Number(b.rating || 0) - Number(a.rating || 0);
    })
    .map((item) => ({ email: normalizedEmail(item.value), type: item.subType === "work" ? "work" as const : "personal" as const, rating: Number(item.rating || 0) }))
    .filter((item, index, rows) => rows.findIndex((candidateRow) => candidateRow.email === item.email) === index)
    .slice(0, MAX_SIGNALHIRE_EMAILS_TO_VERIFY);
}

async function signalHireFallback(candidate: OutreachEmailCandidate, apiKey: string) {
  const identifier = clean(candidate.linkedinUrl, 1_200) || normalizedEmail(candidate.email);
  if (!identifier) return { matched: false as const, candidate: null, creditsLeft: null as number | null };
  const response = await fetch(SIGNALHIRE_URL, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [identifier], withoutWaterfall: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(35_000),
  });
  const creditsHeader = Number(response.headers.get("x-credits-left"));
  const payload = await response.json().catch(() => null) as SignalHireResult[] | { error?: string } | null;
  if (!response.ok) {
    const message = payload && !Array.isArray(payload) ? clean(payload.error, 300) : `HTTP ${response.status}`;
    throw new Error(`SignalHire fallback failed: ${message}`);
  }
  const result = Array.isArray(payload) ? payload[0] : null;
  const person = result?.status === "success" ? result.candidate || null : null;
  if (!person || !companyMatches(person, candidate.companyName, candidate.domain)) {
    return { matched: false as const, candidate: person, creditsLeft: Number.isFinite(creditsHeader) ? creditsHeader : null };
  }
  return { matched: true as const, candidate: person, creditsLeft: Number.isFinite(creditsHeader) ? creditsHeader : null };
}

function recoverableCandidate(candidate: OutreachEmailCandidate) {
  const reason = clean(candidate.blockReason, 500);
  return !/(?:Sales activity|Already entered|Duplicate email)/i.test(reason);
}

export async function runOutreachEmailWaterfall(
  candidates: OutreachEmailCandidate[],
  target: number,
  options: { millionVerifierApiKey?: string; buffer?: number } = {},
): Promise<OutreachEmailWaterfallResult> {
  const millionVerifierApiKey = clean(options.millionVerifierApiKey || process.env.MILLIONVERIFIER_API_KEY, 8_000);
  const signalHireApiKey = clean(process.env.SIGNALHIRE_API_KEY, 8_000);
  if (!millionVerifierApiKey) throw new Error("MILLIONVERIFIER_API_KEY is not available to the outreach verifier.");
  if (!signalHireApiKey) throw new Error("SIGNALHIRE_API_KEY is not configured on the production server.");

  const wanted = Math.max(1, Math.floor(target));
  const buffer = Math.max(0, Math.min(25, Math.floor(options.buffer ?? 10)));
  const pool = candidates.filter(recoverableCandidate).slice(0, wanted + buffer);
  const cache = await readCache();
  const sendableEmails: string[] = [];
  let millionVerifierChecks = 0;
  let millionVerifierCacheHits = 0;
  let signalHireLookups = 0;
  let replacements = 0;
  let validCurrent = 0;
  let noValidEmail = 0;
  let millionVerifierCreditsLeft: number | null = null;
  let signalHireCreditsLeft: number | null = null;

  for (const lead of pool) {
    if (sendableEmails.length >= wanted) break;
    const currentEmail = normalizedEmail(lead.email);
    if (!currentEmail || !isEmail(currentEmail)) {
      noValidEmail += 1;
      continue;
    }

    const current = await verifyEmail(currentEmail, millionVerifierApiKey, cache);
    if (current.cacheHit) millionVerifierCacheHits += 1; else millionVerifierChecks += 1;
    if (current.creditsLeft !== null) millionVerifierCreditsLeft = current.creditsLeft;

    await updateHubSpotContact(lead.contactId, {
      gtm_email_status: current.entry.status,
      gtm_last_enriched_at: dateOnly(),
    });

    if (current.entry.status === "valid") {
      validCurrent += 1;
      sendableEmails.push(currentEmail);
      continue;
    }

    signalHireLookups += 1;
    const fallback = await signalHireFallback(lead, signalHireApiKey).catch(() => ({ matched: false as const, candidate: null, creditsLeft: null as number | null }));
    if (fallback.creditsLeft !== null) signalHireCreditsLeft = fallback.creditsLeft;
    if (!fallback.matched || !fallback.candidate) {
      await updateHubSpotContact(lead.contactId, {
        signalhire_match_status: "failed",
        email_enrichment_status: "no_work_email",
        signalhire_last_enriched_at: dateOnly(),
      });
      noValidEmail += 1;
      continue;
    }

    const alternatives = rankedSignalHireEmails(fallback.candidate, currentEmail);
    let replacement: { email: string; type: "work" } | null = null;
    for (const alternative of alternatives) {
      if (alternative.type !== "work") continue;
      const verified = await verifyEmail(alternative.email, millionVerifierApiKey, cache);
      if (verified.cacheHit) millionVerifierCacheHits += 1; else millionVerifierChecks += 1;
      if (verified.creditsLeft !== null) millionVerifierCreditsLeft = verified.creditsLeft;
      if (verified.entry.status === "valid") {
        replacement = { email: alternative.email, type: "work" };
        break;
      }
    }

    if (!replacement) {
      await updateHubSpotContact(lead.contactId, {
        signalhire_match_status: "success",
        signalhire_uid: clean(fallback.candidate.uid, 160),
        email_enrichment_status: alternatives.some((item) => item.type === "personal") ? "personal_only" : "no_work_email",
        signalhire_last_enriched_at: dateOnly(),
      });
      noValidEmail += 1;
      continue;
    }

    const properties: Record<string, string> = {
      email: replacement.email,
      gtm_email_status: "valid",
      gtm_email_type: replacement.type,
      email_enrichment_status: "work_email_found",
      signalhire_match_status: "success",
      signalhire_uid: clean(fallback.candidate.uid, 160),
      signalhire_last_enriched_at: dateOnly(),
      gtm_last_enriched_at: dateOnly(),
    };
    properties.work_email = replacement.email;
    await updateHubSpotContact(lead.contactId, properties);
    replacements += 1;
    sendableEmails.push(replacement.email);
  }

  return {
    target: wanted,
    considered: pool.length,
    millionVerifierChecks,
    millionVerifierCacheHits,
    signalHireLookups,
    replacements,
    validCurrent,
    noValidEmail,
    millionVerifierCreditsLeft,
    signalHireCreditsLeft,
    sendableEmails: [...new Set(sendableEmails)],
  };
}
