from pathlib import Path

path = Path('src/app/api/target-account-pool/route.ts')
s = path.read_text()

old_type = '''type ApolloPeopleOrganization = {\n  name?: string;\n  has_industry?: boolean;\n  has_employee_count?: boolean;\n};'''
new_type = '''type ApolloPeopleOrganization = {\n  id?: string;\n  name?: string;\n  primary_domain?: string;\n  domain?: string;\n  website_url?: string;\n  website?: string;\n  has_industry?: boolean;\n  has_employee_count?: boolean;\n};'''
if old_type not in s:
    raise SystemExit('ApolloPeopleOrganization anchor not found')
s = s.replace(old_type, new_type, 1)

old_loop = '''    for (const candidate of candidates.slice(0, 2)) {\n      try {\n        const live = await fetch(candidate.url, {'''
new_loop = '''    for (const candidate of candidates.slice(0, 2)) {\n      const fastDomain = normalizeCompanyDomain(candidate.url);\n      const fastIdentityScore = quickIdentityScore(\n        companyName,\n        candidate.url,\n        `${candidate.result.title || ""} ${candidate.result.content || ""}`,\n      );\n      if (fastDomain && !isThirdPartyCompanyDomain(fastDomain, companyName) && fastIdentityScore >= 4) {\n        try {\n          const parsed = new URL(candidate.url);\n          return {\n            domain: fastDomain,\n            website: `${parsed.protocol}//${parsed.host}/`,\n            evidenceUrl: candidate.url,\n            reason: "Fast market stocking resolved the official company identity from a high-confidence web-search result. Career/ATS deep verification is deferred to Verify.",\n          };\n        } catch {}\n      }\n      try {\n        const live = await fetch(candidate.url, {'''
if old_loop not in s:
    raise SystemExit('quick resolver loop anchor not found')
s = s.replace(old_loop, new_loop, 1)

anchor = '''async function apolloPeoplePage(country: TargetAccountCountry, page: number) {'''
helper = '''function quickIdentityFromApolloPerson(person: ApolloPersonSearchRow & { __page?: number }): QuickIdentity | null {\n  const organization = person.organization;\n  if (!organization) return null;\n  const raw = clean(organization.primary_domain || organization.domain || organization.website_url || organization.website, 1000);\n  const domain = normalizeCompanyDomain(raw);\n  const companyName = clean(organization.name, 300);\n  if (!domain || isThirdPartyCompanyDomain(domain, companyName)) return null;\n  let website = `https://${domain}/`;\n  const suppliedWebsite = clean(organization.website_url || organization.website, 1000);\n  if (suppliedWebsite) {\n    try {\n      const parsed = new URL(/^https?:\\/\\//i.test(suppliedWebsite) ? suppliedWebsite : `https://${suppliedWebsite}`);\n      website = `${parsed.protocol}//${parsed.host}/`;\n    } catch {}\n  }\n  return {\n    domain,\n    website,\n    evidenceUrl: suppliedWebsite || website,\n    reason: "Apollo People Search supplied the company domain directly; HubSpot dedupe runs before storage and Career/ATS deep verification is deferred to Verify.",\n  };\n}\n\n'''
if anchor not in s:
    raise SystemExit('apolloPeoplePage anchor not found')
s = s.replace(anchor, helper + anchor, 1)

old_limits = '''  const configuredResolveLimit = Number(process.env.TARGET_POOL_RESOLVE_LIMIT || 6);\n  const resolveLimit = Math.max(3, Math.min(12, Number.isFinite(configuredResolveLimit) ? Math.round(configuredResolveLimit) : 6));'''
new_limits = '''  const configuredCompaniesPerPage = Number(process.env.TARGET_POOL_COMPANIES_PER_PAGE || 25);\n  const companiesPerPage = Math.max(15, Math.min(40, Number.isFinite(configuredCompaniesPerPage) ? Math.round(configuredCompaniesPerPage) : 25));\n  const desiredResolveLimit = Math.min(100, pages * companiesPerPage);\n  const configuredResolveLimit = Number(process.env.TARGET_POOL_RESOLVE_LIMIT || desiredResolveLimit);\n  const resolveLimit = Math.max(10, Math.min(100, Number.isFinite(configuredResolveLimit) ? Math.round(configuredResolveLimit) : desiredResolveLimit));\n  const configuredTavilyFallbackLimit = Number(process.env.TARGET_POOL_TAVILY_FALLBACK_LIMIT || 25);\n  const tavilyFallbackLimit = Math.max(8, Math.min(30, Number.isFinite(configuredTavilyFallbackLimit) ? Math.round(configuredTavilyFallbackLimit) : 25));'''
if old_limits not in s:
    raise SystemExit('resolve limit anchor not found')
s = s.replace(old_limits, new_limits, 1)

old_resolve = '''  const resolved = await mapWithConcurrency(netNewSeeds, 4, async (person) => {\n    const name = clean(person.organization?.name, 300);\n    if (!name) return null;\n    const identity = await quickResolveCompanyIdentity(name);\n    if (!identity?.domain) return null;\n    return { person, name, domain: identity.domain, identity };\n  });'''
new_resolve = '''  const directResolved: Array<{\n    person: ApolloPersonSearchRow & { __page: number };\n    name: string;\n    domain: string;\n    identity: QuickIdentity;\n  }> = [];\n  const tavilySeeds: Array<ApolloPersonSearchRow & { __page: number }> = [];\n\n  for (const person of netNewSeeds) {\n    const name = clean(person.organization?.name, 300);\n    if (!name) continue;\n    const identity = quickIdentityFromApolloPerson(person);\n    if (identity?.domain) {\n      directResolved.push({ person, name, domain: identity.domain, identity });\n    } else {\n      tavilySeeds.push(person);\n    }\n  }\n\n  const fallbackResolved = await mapWithConcurrency(tavilySeeds.slice(0, tavilyFallbackLimit), 8, async (person) => {\n    const name = clean(person.organization?.name, 300);\n    if (!name) return null;\n    const identity = await quickResolveCompanyIdentity(name);\n    if (!identity?.domain) return null;\n    return { person, name, domain: identity.domain, identity };\n  });\n  const resolved = [...directResolved, ...fallbackResolved];'''
if old_resolve not in s:
    raise SystemExit('resolve block anchor not found')
s = s.replace(old_resolve, new_resolve, 1)

old_return = '''    resolvedDomains: uniqueResolved.size,\n    unresolvedCompanies: Math.max(0, netNewSeeds.length - uniqueResolved.size),'''
new_return = '''    resolvedDomains: uniqueResolved.size,\n    directApolloDomains: directResolved.length,\n    tavilyFallbackAttempted: Math.min(tavilySeeds.length, tavilyFallbackLimit),\n    unresolvedCompanies: Math.max(0, netNewSeeds.length - uniqueResolved.size),'''
if old_return not in s:
    raise SystemExit('return metrics anchor not found')
s = s.replace(old_return, new_return, 1)

path.write_text(s)
