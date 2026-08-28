from pathlib import Path

route = Path("src/app/api/target-account-pool/route.ts")
s = route.read_text()

marker = "type ApolloOrganization = Record<string, unknown> & {"
people_types = '''type ApolloPeopleOrganization = {
  name?: string;
  has_industry?: boolean;
  has_employee_count?: boolean;
};

type ApolloPersonSearchRow = {
  id?: string;
  first_name?: string;
  last_name_obfuscated?: string;
  title?: string;
  organization?: ApolloPeopleOrganization;
};

'''
if people_types not in s:
    if marker not in s:
        raise SystemExit("ApolloOrganization marker not found")
    s = s.replace(marker, people_types + marker, 1)

helpers_start = s.find("function apolloUrl(country: TargetAccountCountry, page: number) {")
discover_start = s.find("async function discoverMarket(country: TargetAccountCountry, pages: number) {")
if helpers_start < 0 or discover_start < 0 or helpers_start >= discover_start:
    raise SystemExit("Existing Apollo discovery block not found")

people_helpers = '''const TARGET_PERSON_TITLES = [
  "talent acquisition",
  "human resources",
  "hr director",
  "head of hr",
  "recruitment",
  "chief human resources officer",
  "chief people officer",
] as const;

const TARGET_PERSON_SENIORITIES = ["manager", "director", "vp", "head", "c_suite"] as const;

async function apolloPeoplePage(country: TargetAccountCountry, page: number) {
  const market = targetMarket(country);
  if (!market) throw new Error(`Unsupported target market: ${country}`);
  const apiKey = clean(process.env.APOLLO_API_KEY, 1000);
  if (!apiKey) throw new Error("APOLLO_API_KEY is not configured.");

  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      organization_locations: [country],
      organization_num_employees_ranges: [...TARGET_EMPLOYEE_RANGES],
      organization_naics_codes: market.naics.map(String),
      person_seniorities: [...TARGET_PERSON_SENIORITIES],
      person_titles: [...TARGET_PERSON_TITLES],
      include_similar_titles: true,
      page,
      per_page: 100,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = clean((payload.error as Record<string, unknown> | undefined)?.message || payload.message || `HTTP ${response.status}`);
    throw new Error(`Apollo zero-credit people search failed: ${message}`);
  }
  const people = Array.isArray(payload.people) ? payload.people as ApolloPersonSearchRow[] : [];
  return { people, total: numberValue(payload.total_entries, people.length) };
}

async function existingHubSpotCompanyNames(names: string[]) {
  const result = new Map<string, string>();
  const unique = [...new Set(names.map((name) => clean(name, 300)).filter(Boolean))];
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    try {
      const matches = await searchAll("companies", ["name", "domain", "account_type", "account_status"], [
        { propertyName: "name", operator: "IN", values: chunk },
      ]);
      for (const match of matches) {
        const name = clean(match.properties.name, 300).toLowerCase();
        if (name) result.set(name, String(match.id));
      }
    } catch {
      for (const name of chunk) {
        const matches = await searchAll("companies", ["name", "domain"], [
          { propertyName: "name", operator: "EQ", value: name },
        ]);
        if (matches[0]) result.set(name.toLowerCase(), String(matches[0].id));
      }
    }
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

'''
s = s[:helpers_start] + people_helpers + s[discover_start:]

discover_start = s.find("async function discoverMarket(country: TargetAccountCountry, pages: number) {")
verify_start = s.find("\nasync function verifyAccount(account: AcquisitionAccount)", discover_start)
if discover_start < 0 or verify_start < 0:
    raise SystemExit("discoverMarket boundaries not found")

discover = r'''async function discoverMarket(country: TargetAccountCountry, pages: number) {
  const market = targetMarket(country);
  if (!market) throw new Error(`Unsupported target market: ${country}`);

  const existingPool = await listAcquisitionAccounts({ limit: 1000, country, includeExcluded: true });
  const previousPages = existingPool.accounts
    .map((account) => Number(account.evidence?.apolloPeoplePage || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const startPage = previousPages.length ? Math.max(...previousPages) + 1 : 1;
  const configuredResolveLimit = Number(process.env.TARGET_POOL_RESOLVE_LIMIT || 12);
  const resolveLimit = Math.max(5, Math.min(30, Number.isFinite(configuredResolveLimit) ? Math.round(configuredResolveLimit) : 12));

  const people: Array<ApolloPersonSearchRow & { __page: number }> = [];
  let peopleTotal = 0;
  let pagesUsed = 0;
  const companyNames = new Set<string>();

  for (let offset = 0; offset < pages; offset += 1) {
    const page = startPage + offset;
    const result = await apolloPeoplePage(country, page);
    peopleTotal = Math.max(peopleTotal, result.total);
    pagesUsed += 1;
    for (const person of result.people) {
      const companyName = clean(person.organization?.name, 300);
      if (!companyName) continue;
      people.push({ ...person, __page: page });
      companyNames.add(companyName.toLowerCase());
    }
    if (!result.people.length || companyNames.size >= resolveLimit) break;
  }

  const seedByCompany = new Map<string, ApolloPersonSearchRow & { __page: number }>();
  for (const person of people) {
    const companyName = clean(person.organization?.name, 300);
    const key = companyName.toLowerCase();
    if (!companyName || seedByCompany.has(key)) continue;
    seedByCompany.set(key, person);
    if (seedByCompany.size >= resolveLimit) break;
  }

  const names = [...seedByCompany.values()]
    .map((person) => clean(person.organization?.name, 300))
    .filter(Boolean);
  const hubspotByName = await existingHubSpotCompanyNames(names);
  const netNewSeeds = [...seedByCompany.values()].filter((person) => {
    const name = clean(person.organization?.name, 300).toLowerCase();
    return name && !hubspotByName.has(name);
  });

  const resolved = await mapWithConcurrency(netNewSeeds, 6, async (person) => {
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

  const uniqueResolved = new Map<string, NonNullable<(typeof resolved)[number]>>();
  for (const item of resolved) {
    if (!item || uniqueResolved.has(item.domain)) continue;
    uniqueResolved.set(item.domain, item);
  }

  const hubspotByDomain = await existingHubSpotDomains([...uniqueResolved.keys()]);
  const accounts: AcquisitionAccount[] = [...uniqueResolved.values()].map(({ person, name, domain, intelligence }) => {
    const industry = "Target industry";
    const exclusion = classifyExclusion({
      name,
      website_url: intelligence.website,
      seo_description: intelligence.verificationReason,
    }, domain);
    const hubspotCompanyId = hubspotByDomain.get(domain) || "";
    const finalExclusion = hubspotCompanyId
      ? { status: "excluded" as const, reason: "Already exists in HubSpot" }
      : exclusion;
    const scored = scoreTalenteraAccount({
      companyId: clean(person.id, 160) || domain,
      name,
      domain,
      country,
      employeeCount: 0,
      industry,
      activeJobs: 0,
      newJobs30d: 0,
      ats: intelligence.detectedAts || "",
    });
    const marketBonus = market.priority >= 88 ? 8 : market.priority >= 74 ? 5 : 2;
    const gtmScore = Math.min(100, scored.score + marketBonus + 5);
    const gtmTier = gtmScore >= 75 ? "A" : gtmScore >= 55 ? "B" : gtmScore >= 40 ? "C" : "Watch";

    return {
      domain,
      name,
      source: `Apollo People Target Pool · ${country}`,
      sourceId: clean(person.id, 160),
      country,
      employeeCount: 0,
      industry,
      activeJobs: 0,
      headcountGrowth: 0,
      hrHeadcount: 0,
      careerPageUrl: intelligence.careerPageUrl || "",
      detectedAts: intelligence.detectedAts || "",
      gtmScore,
      gtmTier,
      fitScore: scored.fitScore,
      intentScore: scored.intentScore,
      atsOpportunityScore: scored.atsOpportunityScore,
      exclusionStatus: finalExclusion.status,
      exclusionReason: finalExclusion.reason,
      hubspotCompanyId,
      status: finalExclusion.status === "excluded" ? "excluded" : "candidate",
      primaryPersona: scored.personas.primary,
      secondaryPersona: scored.personas.secondary,
      economicBuyer: scored.personas.economicBuyer,
      technicalInfluencer: scored.personas.technicalInfluencer,
      strongestSignal: `${country} target · 201+ employee filter · senior HR/TA persona present${intelligence.careerPageUrl ? " · career verified" : ""}`,
      recommendedAngle: scored.recommendedAngle,
      assignedOwnerId: "",
      assignedOwnerName: "",
      evidence: {
        targetPool: true,
        targetCountry: country,
        marketPhase: market.phase,
        marketPriority: market.priority,
        marketUniverse: market.marketSize,
        targetIndustries: market.industries,
        targetNaics: market.naics,
        apolloPeopleDiscovery: true,
        apolloPeoplePage: Number(person.__page || startPage),
        apolloPeopleTotal: peopleTotal,
        apolloSeedPersonId: clean(person.id, 160),
        apolloSeedFirstName: clean(person.first_name, 120),
        apolloSeedLastNameMasked: clean(person.last_name_obfuscated, 120),
        apolloSeedTitle: clean(person.title, 300),
        resolvedOfficialDomain: domain,
        officialWebsite: intelligence.website,
        careerEvidenceUrl: intelligence.evidenceUrl,
        careerConfidence: intelligence.careerConfidence,
        atsConfidence: intelligence.atsConfidence,
        verificationReason: intelligence.verificationReason,
        rawHiringObservation: intelligence.hiring,
        targetPoolVerifiedAt: new Date().toISOString(),
        targetPoolVerificationStatus: hubspotCompanyId ? "hubspot-existing" : "verified",
        discoveredAt: new Date().toISOString(),
        discoveryPolicy: "Apollo People Search (0 search credits): target country + 201+ employees + target NAICS + senior HR/TA; official domain and Career/ATS checked before storage",
        hiringCountPolicy: "Hiring observation stored as evidence only; raw Apollo job counts do not boost Target Pool score",
        feedMaritaRequested: false,
      },
    };
  });

  await upsertAcquisitionAccounts(accounts);
  const existingByDomain = accounts.filter((item) => item.exclusionReason === "Already exists in HubSpot").length;
  return {
    country,
    marketTotal: market.marketSize,
    peopleTotal,
    startPage,
    pagesUsed,
    peopleScanned: people.length,
    companyCandidates: seedByCompany.size,
    existingHubSpotByName: hubspotByName.size,
    resolvedDomains: uniqueResolved.size,
    unresolvedCompanies: Math.max(0, netNewSeeds.length - uniqueResolved.size),
    uniqueDomains: accounts.length,
    eligible: accounts.filter((item) => item.exclusionStatus === "eligible").length,
    review: accounts.filter((item) => item.exclusionStatus === "review").length,
    excluded: accounts.filter((item) => item.exclusionStatus === "excluded").length,
    existingHubSpot: hubspotByName.size + existingByDomain,
    discoveryMode: "apollo_people_zero_credit",
  };
}
'''
s = s[:discover_start] + discover + s[verify_start:]
s = s.replace(
    'return NextResponse.json({ error: "Valid Owner PIN is required." }, { status: 401 });',
    'return NextResponse.json({ error: "Admin password access is required." }, { status: 401 });',
)
route.write_text(s)

ui = Path("src/components/TargetAccountPool.tsx")
u = ui.read_text()
u = u.replace(
    '`Load up to ${pages * 100} ${currentMarket.country} companies into the dashboard pool? This can consume up to ${pages} Apollo credit${pages === 1 ? "" : "s"}. Nothing will be written to HubSpot.`',
    '`Scan up to ${pages * 100} senior HR/TA profiles in ${currentMarket.country} and stock verified net-new companies? Apollo People Search uses 0 search credits. Nothing will be written to HubSpot.`',
)
u = u.replace(
    'setNotice(`${currentMarket.country}: ${String(result.uniqueDomains || 0)} domains stored · ${String(result.eligible || 0)} eligible · ${String(result.existingHubSpot || 0)} already in HubSpot.`);',
    'setNotice(`${currentMarket.country}: ${String(result.peopleScanned || 0)} HR/TA profiles scanned · ${String(result.uniqueDomains || 0)} domains stored · ${String(result.eligible || 0)} eligible · ${String(result.existingHubSpot || 0)} already in HubSpot · ${String(result.unresolvedCompanies || 0)} unresolved.`);',
)
u = u.replace('<span>Pages to load</span>', '<span>People pages to scan</span>')
u = u.replace('{page} · up to {page * 100} companies', '{page} · up to {page * 100} HR/TA profiles')
u = u.replace(
    'Up to <strong>{pages}</strong> Apollo credit{pages === 1 ? "" : "s"}. Domain dedupe happens before the account becomes eligible.',
    '<strong>0 Apollo search credits.</strong> HR/TA-first discovery · domain + Career/ATS verification before storage.',
)
ui.write_text(u)
