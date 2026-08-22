import { upsertAcquisitionAccounts, type AcquisitionAccount } from "@/lib/acquisition-data-api";
import { searchAll } from "@/lib/hubspot";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";

export type ApprovedSeedAccount = {
  name: string;
  domain: string;
  country: "Saudi Arabia" | "United Arab Emirates";
  growth6m: number;
};

// Curated from the user-approved six-page Apollo pull on 2026-08-22.
// Every source row matched the upstream 201–2,000 employee + 5+ active jobs filter.
// Government/semi-government and obvious ATS/recruitment-tech competitors are intentionally omitted.
export const APPROVED_APOLLO_SEED: ApprovedSeedAccount[] = [
  { name: "Wynn Al Marjan Island", domain: "wynnalmarjanisland.com", country: "United Arab Emirates", growth6m: 22.5 },
  { name: "Astra Tech", domain: "astratech.ae", country: "United Arab Emirates", growth6m: 7.6 },
  { name: "Alaan", domain: "alaan.com", country: "United Arab Emirates", growth6m: 10.5 },
  { name: "Styli", domain: "stylishop.com", country: "United Arab Emirates", growth6m: 8.3 },
  { name: "EC Markets", domain: "ecmarkets.com", country: "United Arab Emirates", growth6m: 28.9 },
  { name: "Mnzil", domain: "mnzil.com", country: "Saudi Arabia", growth6m: 28.1 },
  { name: "PRYPCO", domain: "prypco.com", country: "United Arab Emirates", growth6m: 9.4 },
  { name: "White & Co Real Estate", domain: "whiteandcogroup.com", country: "United Arab Emirates", growth6m: 6.2 },
  { name: "Savills Middle East", domain: "savills.me", country: "United Arab Emirates", growth6m: 2.5 },
  { name: "GeoServe", domain: "geoserves.com", country: "United Arab Emirates", growth6m: 6.8 },
  { name: "JAL | جال", domain: "jal.com.sa", country: "Saudi Arabia", growth6m: 6.1 },
  { name: "Dussmann-Ajlan & Bros", domain: "dussmann-ajlanbros.com", country: "Saudi Arabia", growth6m: 3.0 },
  { name: "InsuranceMarket.ae", domain: "insurancemarket.ae", country: "United Arab Emirates", growth6m: 4.7 },
  { name: "DataScience Middle East", domain: "datascience.me", country: "United Arab Emirates", growth6m: 6.6 },
  { name: "Taj Dhabi", domain: "tajdhabi.com", country: "Saudi Arabia", growth6m: 4.2 },
  { name: "AlHuda Centre of Islamic Banking & Economics", domain: "alhudacibe.com", country: "United Arab Emirates", growth6m: 16.4 },
  { name: "Evolution Engineering Services", domain: "ees-int.com", country: "United Arab Emirates", growth6m: 0.0 },
  { name: "Metropolitan Capital Real Estate", domain: "abu-dhabi.realestate", country: "United Arab Emirates", growth6m: 0.3 },
  { name: "Al Shirawi Interiors", domain: "alshirawiinteriors.com", country: "United Arab Emirates", growth6m: 4.3 },
  { name: "International Community Schools", domain: "icschools.ae", country: "United Arab Emirates", growth6m: 0.6 },
  { name: "Khadamat Facilities Management", domain: "khadamat.ae", country: "United Arab Emirates", growth6m: 8.6 },
  { name: "Liwa Education", domain: "liwaeducation.com", country: "United Arab Emirates", growth6m: 3.3 },
  { name: "Blue Ocean Corporation", domain: "blueoceancorporation.com", country: "United Arab Emirates", growth6m: 10.7 },
  { name: "CC7 Global Engineering Solutions", domain: "cc7international.com", country: "United Arab Emirates", growth6m: 23.1 },
  { name: "AVAR", domain: "avarglobal.com", country: "United Arab Emirates", growth6m: 2.1 },
  { name: "Zouma Consulting Services", domain: "zouma.ai", country: "United Arab Emirates", growth6m: 5.2 },
  { name: "Dugasta", domain: "dugasta.com", country: "United Arab Emirates", growth6m: 0.6 },
  { name: "Data Semantics", domain: "datasemantics.co", country: "United Arab Emirates", growth6m: 1.5 },
  { name: "Pickl", domain: "eatpickl.com", country: "United Arab Emirates", growth6m: -1.0 },
  { name: "Jeebly", domain: "jeebly.com", country: "United Arab Emirates", growth6m: 1.9 },
  { name: "Fortes Education", domain: "forteseducation.com", country: "United Arab Emirates", growth6m: -2.7 },
  { name: "Royal Health Group", domain: "royalhealth.ae", country: "United Arab Emirates", growth6m: 2.2 },
  { name: "The Meydan Hotel", domain: "themeydanhotel.com", country: "United Arab Emirates", growth6m: 2.7 },
  { name: "Addmind Hospitality", domain: "addmind.com", country: "United Arab Emirates", growth6m: 3.0 },
  { name: "GymNation", domain: "gymnation.com", country: "United Arab Emirates", growth6m: 1.8 },
  { name: "Arabian Oud", domain: "arabianoud.com", country: "Saudi Arabia", growth6m: 2.0 },
  { name: "Bidfood Middle East", domain: "bidfoodme.com", country: "United Arab Emirates", growth6m: 2.0 },
  { name: "AMEA Power", domain: "ameapower.com", country: "United Arab Emirates", growth6m: 4.7 },
  { name: "Gulftainer", domain: "gulftainer.com", country: "United Arab Emirates", growth6m: 8.4 },
  { name: "Whitewill", domain: "whitewill.ae", country: "United Arab Emirates", growth6m: 7.2 },
  { name: "GCG Enterprise Solutions", domain: "gcg.ae", country: "United Arab Emirates", growth6m: 2.8 },
  { name: "Al Ain University", domain: "aau.ac.ae", country: "United Arab Emirates", growth6m: 0.7 },
  { name: "Eton Institute", domain: "etoninstitute.com", country: "United Arab Emirates", growth6m: 0.0 },
  { name: "MEMAR | معمار", domain: "memar.sa", country: "Saudi Arabia", growth6m: 4.2 },
  { name: "Nascom Facilities Management", domain: "nascom.sa", country: "Saudi Arabia", growth6m: 1.8 },
  { name: "Karan Group", domain: "karan.ae", country: "United Arab Emirates", growth6m: -2.5 },
  { name: "Al Nahda Centre", domain: "alnahdacentre.com", country: "United Arab Emirates", growth6m: 1.6 },
  { name: "Greenwood International School", domain: "greenwood.sch.ae", country: "United Arab Emirates", growth6m: 0.0 },
  { name: "Thamer International Schools", domain: "tis.edu.sa", country: "Saudi Arabia", growth6m: -1.4 },
  { name: "King Faisal School", domain: "kfs.sch.sa", country: "Saudi Arabia", growth6m: -1.1 },
  { name: "Sunmarke School", domain: "sunmarke.com", country: "United Arab Emirates", growth6m: 0.0 },
  { name: "Dr Joy Dental Clinic", domain: "drjoydentalclinic.com", country: "United Arab Emirates", growth6m: 3.1 },
  { name: "Al Tadawi Medical Centre", domain: "altadawimedical.com", country: "United Arab Emirates", growth6m: 0.0 },
  { name: "Consolidated Shipping Group", domain: "cssgroupsite.com", country: "United Arab Emirates", growth6m: 2.9 },
  { name: "Motivate Media Group", domain: "motivatemedia.com", country: "United Arab Emirates", growth6m: 1.4 },
  { name: "HLB HAMT", domain: "hlbhamt.com", country: "United Arab Emirates", growth6m: 2.0 },
  { name: "athGADLANG", domain: "athgadlang.com", country: "United Arab Emirates", growth6m: 1.4 },
  { name: "Mohammed Mansour Al-Rumaih", domain: "mmr.com.sa", country: "Saudi Arabia", growth6m: 1.3 },
  { name: "Bevatel", domain: "bevatel.com", country: "Saudi Arabia", growth6m: 4.0 },
  { name: "CyberGate Defense", domain: "cybergate.tech", country: "United Arab Emirates", growth6m: 2.0 },
  { name: "Precision Group", domain: "pdtmc.com", country: "United Arab Emirates", growth6m: 0.0 },
];

function tierFor(score: number): AcquisitionAccount["gtmTier"] {
  if (score >= 78) return "A";
  if (score >= 62) return "B";
  if (score >= 45) return "C";
  return "Watch";
}

function growthBonus(growth6m: number) {
  if (growth6m >= 20) return 20;
  if (growth6m >= 10) return 15;
  if (growth6m >= 5) return 10;
  if (growth6m > 0) return 5;
  return 0;
}

async function existingHubSpotDomains(domains: string[]) {
  const existing = new Map<string, string>();
  for (let index = 0; index < domains.length; index += 100) {
    const chunk = domains.slice(index, index + 100);
    const matches = await searchAll("companies", ["name", "domain"], [
      { propertyName: "domain", operator: "IN", values: chunk },
    ]);
    for (const match of matches) {
      const domain = normalizeCompanyDomain(String(match.properties.domain || ""));
      if (domain) existing.set(domain, String(match.id));
    }
  }
  return existing;
}

export async function seedApprovedApolloAccounts() {
  const normalized = APPROVED_APOLLO_SEED.map((row) => ({ ...row, domain: normalizeCompanyDomain(row.domain) }))
    .filter((row): row is ApprovedSeedAccount => Boolean(row.domain));
  const existing = await existingHubSpotDomains(normalized.map((row) => row.domain));

  const accounts: AcquisitionAccount[] = normalized.map((row) => {
    // 201 is a conservative floor, not a guessed exact count: every seed passed Apollo's 201–2,000 filter.
    const employeeCount = 201;
    // 5 is likewise the guaranteed floor from the approved Apollo discovery filter.
    const activeJobs = 5;
    const scored = scoreTalenteraAccount({
      companyId: `approved-seed:${row.domain}`,
      name: row.name,
      domain: row.domain,
      country: row.country,
      employeeCount,
      industry: "",
      activeJobs,
      newJobs30d: 0,
      ats: "",
    });
    const bonus = growthBonus(row.growth6m);
    const gtmScore = Math.min(100, scored.score + bonus);
    const intentScore = Math.min(100, scored.intentScore + bonus);
    const hubspotCompanyId = existing.get(row.domain) || "";
    const excluded = Boolean(hubspotCompanyId);
    const growthSignal = row.growth6m > 0 ? ` · 6m headcount +${row.growth6m.toFixed(1)}%` : "";

    return {
      domain: row.domain,
      name: row.name,
      source: "Apollo · approved six-page pull",
      sourceId: `approved-seed:${row.domain}`,
      country: row.country,
      employeeCount,
      industry: "",
      activeJobs,
      headcountGrowth: row.growth6m,
      hrHeadcount: 0,
      careerPageUrl: "",
      detectedAts: "",
      gtmScore,
      gtmTier: tierFor(gtmScore),
      fitScore: scored.fitScore,
      intentScore,
      atsOpportunityScore: scored.atsOpportunityScore,
      exclusionStatus: excluded ? "excluded" : "eligible",
      exclusionReason: excluded ? "Already exists in HubSpot" : "",
      hubspotCompanyId,
      status: excluded ? "excluded" : "candidate",
      primaryPersona: scored.personas.primary,
      secondaryPersona: scored.personas.secondary,
      economicBuyer: scored.personas.economicBuyer,
      technicalInfluencer: scored.personas.technicalInfluencer,
      strongestSignal: `Apollo-qualified medium account · 5+ active jobs${growthSignal}`,
      recommendedAngle: scored.recommendedAngle,
      assignedOwnerId: "",
      assignedOwnerName: "",
      evidence: {
        discoveryDate: "2026-08-22",
        source: "Chat-approved Apollo six-page discovery",
        employeeRange: "201–2,000",
        minimumActiveJobs: 5,
        growth6mPercent: row.growth6m,
        employeeCountIsConservativeFloor: true,
        activeJobsIsConservativeFloor: true,
      },
    };
  });

  await upsertAcquisitionAccounts(accounts);
  return {
    stored: accounts.length,
    eligible: accounts.filter((account) => account.exclusionStatus === "eligible").length,
    existingHubSpot: accounts.filter((account) => account.exclusionReason === "Already exists in HubSpot").length,
    accounts,
  };
}
