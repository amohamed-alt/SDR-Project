import { inspectProspectCompany as inspectUncachedProspectCompany } from "@/lib/prospecting-company-intelligence-tavily";
import {
  normalizeCompanyDomain,
  type ProspectCompanyIntelligence,
} from "@/lib/prospecting-company-intelligence";

type ProspectCompanyInput = {
  companyName: string;
  website: string;
  emails: string[];
};

type CacheEntry = {
  expiresAt: number;
  value?: ProspectCompanyIntelligence;
  promise?: Promise<ProspectCompanyIntelligence>;
};

type IntelligenceCacheGlobal = typeof globalThis & {
  __prospectingCompanyIntelligenceCache?: Map<string, CacheEntry>;
};

const globalCache = globalThis as IntelligenceCacheGlobal;
const cache = globalCache.__prospectingCompanyIntelligenceCache
  || new Map<string, CacheEntry>();

globalCache.__prospectingCompanyIntelligenceCache = cache;

function ttlMs() {
  const configured = Number(process.env.PROSPECTING_INTELLIGENCE_CACHE_TTL_MS || 0);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 6 * 60 * 60 * 1000;
}

function cacheKey(input: ProspectCompanyInput) {
  const companyName = input.companyName.trim().toLowerCase().replace(/\s+/g, " ");
  const emailDomain = input.emails
    .map((email) => String(email || "").toLowerCase().split("@")[1] || "")
    .map(normalizeCompanyDomain)
    .find(Boolean) || "";
  const domain = normalizeCompanyDomain(input.website) || emailDomain;
  return `${domain}|${companyName}`;
}

function cleanupExpired(now: number) {
  if (cache.size < 500) return;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size <= 1000) return;
  const overflow = cache.size - 1000;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export async function inspectProspectCompany(
  input: ProspectCompanyInput,
): Promise<ProspectCompanyIntelligence> {
  const key = cacheKey(input);
  if (!key.replace(/\|/g, "")) return inspectUncachedProspectCompany(input);

  const now = Date.now();
  cleanupExpired(now);

  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    if (existing.value) return existing.value;
    if (existing.promise) return existing.promise;
  }

  const promise = inspectUncachedProspectCompany(input)
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs(),
      });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, {
    promise,
    expiresAt: now + ttlMs(),
  });

  return promise;
}
