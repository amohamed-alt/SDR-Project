from pathlib import Path

route = Path('src/app/api/target-account-pool/route.ts')
s = route.read_text()

s = s.replace(
    'import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";\n',
    'import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";\nimport { isThirdPartyCompanyDomain } from "@/lib/company-domain-safety";\n',
)

anchor = 'const TARGET_PERSON_SENIORITIES = ["manager", "director", "vp", "head", "c_suite"] as const;\n\n'
helper = r'''const QUICK_DOMAIN_STOP_WORDS = new Set([
  "group", "company", "companies", "holding", "holdings", "limited", "ltd", "llc", "inc", "corp", "corporation",
  "saudi", "arabia", "ksa", "egypt", "uae", "the", "and", "for", "international", "services",
]);

type QuickIdentity = { domain: string; website: string; evidenceUrl: string; reason: string };
type TavilyLiteResult = { title?: string; url?: string; content?: string; score?: number };

function quickCompanyTokens(companyName: string) {
  return companyName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((word) => word.length >= 3 && !QUICK_DOMAIN_STOP_WORDS.has(word));
}

function quickIdentityScore(companyName: string, url: string, text: string) {
  const tokens = quickCompanyTokens(companyName);
  if (!tokens.length) return 0;
  const domain = normalizeCompanyDomain(url).replace(/[^a-z0-9]/g, "");
  const haystack = `${url} ${text}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
    if (domain.includes(token.replace(/[^a-z0-9]/g, ""))) score += 2;
  }
  return score;
}

async function quickResolveCompanyIdentity(companyName: string): Promise<QuickIdentity | null> {
  const apiKey = clean(process.env.TAVILY_API_KEY, 1000);
  if (!apiKey || !companyName.trim()) return null;
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `\"${companyName}\" official company website`, topic: "general", search_depth: "basic",
        max_results: 6, include_answer: false, include_raw_content: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({})) as { results?: TavilyLiteResult[] };
    const candidates = (payload.results || []).map((result) => ({
      result,
      url: clean(result.url, 1000),
      score: Number(result.score || 0) + quickIdentityScore(companyName, clean(result.url, 1000), `${result.title || ""} ${result.content || ""}`),
    })).filter((item) => item.url && !isThirdPartyCompanyDomain(item.url, companyName) && item.score >= 2)
      .sort((a, b) => b.score - a.score);

    for (const candidate of candidates.slice(0, 2)) {
      try {
        const live = await fetch(candidate.url, {
          redirect: "follow", cache: "no-store",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; TalenteraGTM/2.5; +https://talentera.com)" },
          signal: AbortSignal.timeout(4_000),
        });
        if (!live.ok) continue;
        const contentType = live.headers.get("content-type") || "";
        if (!/html|text/i.test(contentType)) continue;
        const html = (await live.text()).slice(0, 350_000);
        const finalUrl = live.url || candidate.url;
        const domain = normalizeCompanyDomain(finalUrl);
        if (!domain || isThirdPartyCompanyDomain(domain, companyName)) continue;
        if (quickIdentityScore(companyName, finalUrl, `${candidate.result.title || ""} ${candidate.result.content || ""} ${html}`) < 3) continue;
        const parsed = new URL(finalUrl);
        return {
          domain,
          website: `${parsed.protocol}//${parsed.host}/`,
          evidenceUrl: candidate.url,
          reason: "Fast market stocking resolved the official company identity from web search and a live brand check. Career/ATS deep verification is deferred to Verify.",
        };
      } catch {}
    }
  } catch {}
  return null;
}

'''
if helper not in s:
    if anchor not in s:
        raise SystemExit('seniority anchor not found')
    s = s.replace(anchor, anchor + helper, 1)

s = s.replace(
    'const configuredResolveLimit = Number(process.env.TARGET_POOL_RESOLVE_LIMIT || 12);\n  const resolveLimit = Math.max(5, Math.min(30, Number.isFinite(configuredResolveLimit) ? Math.round(configuredResolveLimit) : 12));',
    'const configuredResolveLimit = Number(process.env.TARGET_POOL_RESOLVE_LIMIT || 6);\n  const resolveLimit = Math.max(3, Math.min(12, Number.isFinite(configuredResolveLimit) ? Math.round(configuredResolveLimit) : 6));',
)

old_resolve = r'''  const resolved = await mapWithConcurrency(netNewSeeds, 6, async (person) => {
    const name = clean(person.organization?.name, 300);
    if (!name) return null;
    try {
      const intelligence = await inspectProspectCompany({ companyName: name, website: "", emails: [] });
      const domain = normalizeCompanyDomain(intelligence.domain || intelligence.website);
      if (!domain) return null;
      return { person, name, domain, intelligence };
    } catch {
      return null;
    }
  });
'''
new_resolve = r'''  const resolved = await mapWithConcurrency(netNewSeeds, 4, async (person) => {
    const name = clean(person.organization?.name, 300);
    if (!name) return null;
    const identity = await quickResolveCompanyIdentity(name);
    if (!identity?.domain) return null;
    return { person, name, domain: identity.domain, identity };
  });
'''
if old_resolve not in s:
    raise SystemExit('deep resolve block not found')
s = s.replace(old_resolve, new_resolve, 1)
s = s.replace('const accounts: AcquisitionAccount[] = [...uniqueResolved.values()].map(({ person, name, domain, intelligence }) => {', 'const accounts: AcquisitionAccount[] = [...uniqueResolved.values()].map(({ person, name, domain, identity }) => {', 1)
s = s.replace('website_url: intelligence.website,\n      seo_description: intelligence.verificationReason,', 'website_url: identity.website,\n      seo_description: identity.reason,', 1)
s = s.replace('ats: intelligence.detectedAts || "",', 'ats: "",', 1)
s = s.replace('careerPageUrl: intelligence.careerPageUrl || "",\n      detectedAts: intelligence.detectedAts || "",', 'careerPageUrl: "",\n      detectedAts: "",', 1)
s = s.replace('strongestSignal: `${country} target · 201+ employee filter · senior HR/TA persona present${intelligence.careerPageUrl ? " · career verified" : ""}`,', 'strongestSignal: `${country} target · 201+ employee filter · senior HR/TA persona present · official domain resolved`,', 1)
s = s.replace(
    'officialWebsite: intelligence.website,\n        careerEvidenceUrl: intelligence.evidenceUrl,\n        careerConfidence: intelligence.careerConfidence,\n        atsConfidence: intelligence.atsConfidence,\n        verificationReason: intelligence.verificationReason,\n        rawHiringObservation: intelligence.hiring,\n        targetPoolVerifiedAt: new Date().toISOString(),\n        targetPoolVerificationStatus: hubspotCompanyId ? "hubspot-existing" : "verified",',
    'officialWebsite: identity.website,\n        identityEvidenceUrl: identity.evidenceUrl,\n        identityResolvedAt: new Date().toISOString(),\n        verificationReason: identity.reason,\n        targetPoolVerificationStatus: hubspotCompanyId ? "hubspot-existing" : "identity-resolved",',
    1,
)
s = s.replace(
    'discoveryPolicy: "Apollo People Search (0 search credits): target country + 201+ employees + target NAICS + senior HR/TA; official domain and Career/ATS checked before storage",',
    'discoveryPolicy: "Apollo People Search (0 search credits): target country + 201+ employees + target NAICS + senior HR/TA; fast official-domain resolution + HubSpot domain gate before storage; Career/ATS deferred to Verify",',
    1,
)
route.write_text(s)

ui = Path('src/components/TargetAccountPool.tsx')
u = ui.read_text()
old_owner = r'''  async function ownerAction(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as Record<string, unknown> & { error?: string };
    if (response.status === 401) {
      setAdminUnlocked(false);
      window.dispatchEvent(new CustomEvent("sdr:admin-auth-changed"));
      throw new Error("Admin access is locked. Open SDR Tools → Advanced & Data Ops and enter the admin password.");
    }
    if (!response.ok) throw new Error(data.error || "Target Pool action failed.");
    return data;
  }
'''
new_owner = r'''  async function ownerAction(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    let data: Record<string, unknown> & { error?: string } = {};
    if (raw.trim()) {
      try { data = JSON.parse(raw) as Record<string, unknown> & { error?: string }; }
      catch { throw new Error(`Target Pool returned an invalid response (${response.status}). Refresh and retry.`); }
    }
    if (response.status === 401) {
      setAdminUnlocked(false);
      window.dispatchEvent(new CustomEvent("sdr:admin-auth-changed"));
      throw new Error("Admin access is locked. Open SDR Tools → Advanced & Data Ops and enter the admin password.");
    }
    if (!response.ok) throw new Error(data.error || `Target Pool request failed (${response.status}).`);
    if (!raw.trim()) throw new Error("Target Pool server returned an empty response. The request may have timed out; refresh and retry.");
    return data;
  }
'''
if old_owner not in u:
    raise SystemExit('ownerAction block not found')
u = u.replace(old_owner, new_owner, 1)
u = u.replace(
    '`Scan up to ${pages * 100} senior HR/TA profiles in ${currentMarket.country} and stock verified net-new companies? Apollo People Search uses 0 search credits. Nothing will be written to HubSpot.`',
    '`Scan up to ${pages * 100} senior HR/TA profiles in ${currentMarket.country} and stock net-new companies? Apollo People Search uses 0 search credits. Fast official-domain + HubSpot checks run now; Career/ATS deep verification runs later on Verify. Nothing will be written to HubSpot.`',
    1,
)
u = u.replace(
    '<strong>0 Apollo search credits.</strong> HR/TA-first discovery · domain + Career/ATS verification before storage.',
    '<strong>0 Apollo search credits.</strong> HR/TA-first discovery · fast official-domain + HubSpot check now · Career/ATS on Verify.',
    1,
)
ui.write_text(u)
