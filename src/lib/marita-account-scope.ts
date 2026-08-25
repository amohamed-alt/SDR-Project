import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { getHiringStore } from "@/lib/hiring-signals";
import {
  getTalenteraMarket,
  type TalenteraAccountInput,
} from "@/lib/talentera-intelligence";

const OWNER_ID = "31644369";
const SOURCE_LABEL = "INTEGRATION";
const SOURCE_DETAIL = "Extensive-Lighter";
const CACHE_TTL_MS = 5 * 60 * 1000;

const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "country",
  "hs_country_code",
  "gtm_country",
  "industry",
  "gtm_industry",
  "numberofemployees",
  "gtm_employee_count",
  "career_page_url",
  "detected_ats",
  "ats_status",
  "ats_category",
  "ats_confidence",
  "gtm_hiring_signal",
  "company_tier",
  "hs_reason_to_reach_out",
  "account_type",
  "hs_num_open_deals",
] as const;

export type MaritaScopedAccount = TalenteraAccountInput & {
  taskCount: number;
  contactCount: number;
  taskIds: string[];
  hubspotUrl: string;
  atsStatus: string;
  atsCategory: string;
  atsConfidence: string;
  hiringSignal: string;
  reasonToReachOut: string;
  existingCompanyTier: string;
  sourceLastCheckedAt: string;
  sourceLastSuccessfulCheckAt: string;
  sourceUrl: string;
  hiringStatus: string;
  trend: string;
};

export type MaritaScopeSnapshot = {
  generatedAt: string;
  taskCount: number;
  companyCountBeforeMarketFilter: number;
  companies: MaritaScopedAccount[];
};

type ScopeCache = {
  expiresAt: number;
  value?: MaritaScopeSnapshot;
  inflight?: Promise<MaritaScopeSnapshot>;
};

let cache: ScopeCache = { expiresAt: 0 };

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function domainKey(value: unknown) {
  const raw = clean(value, 300).toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function hubspotCompanyUrl(companyId: string) {
  const portalId = clean(process.env.HUBSPOT_PORTAL_ID || "145742477", 40);
  const uiDomain = clean(process.env.HUBSPOT_UI_DOMAIN || "app-eu1.hubspot.com", 200);
  return `https://${uiDomain}/contacts/${portalId}/company/${encodeURIComponent(companyId)}`;
}

async function targetTasks() {
  return searchAll(
    "tasks",
    ["hs_task_status", "hubspot_owner_id", "hs_object_source_label", "hs_object_source_detail_1"],
    [
      { propertyName: "hubspot_owner_id", operator: "EQ", value: OWNER_ID },
      { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
      { propertyName: "hs_object_source_label", operator: "EQ", value: SOURCE_LABEL },
      { propertyName: "hs_object_source_detail_1", operator: "EQ", value: SOURCE_DETAIL },
    ],
    ["hs_object_id"],
  );
}

async function buildScope(): Promise<MaritaScopeSnapshot> {
  const [tasks, hiringStore] = await Promise.all([targetTasks(), getHiringStore()]);
  const taskIds = tasks.map((task) => String(task.id));

  const [directCompanyAssociations, taskContactAssociations] = await Promise.all([
    readAssociations("tasks", "companies", taskIds),
    readAssociations("tasks", "contacts", taskIds),
  ]);

  const contactIds = [...new Set([...taskContactAssociations.values()].flat())];
  const contactCompanyAssociations = await readAssociations("contacts", "companies", contactIds);

  const taskCompanies = new Map<string, Set<string>>();
  const companyTasks = new Map<string, Set<string>>();
  const companyContacts = new Map<string, Set<string>>();

  for (const taskId of taskIds) {
    const companyIds = new Set<string>(directCompanyAssociations.get(taskId) || []);
    for (const contactId of taskContactAssociations.get(taskId) || []) {
      for (const companyId of contactCompanyAssociations.get(contactId) || []) {
        companyIds.add(companyId);
        if (!companyContacts.has(companyId)) companyContacts.set(companyId, new Set());
        companyContacts.get(companyId)!.add(contactId);
      }
    }
    taskCompanies.set(taskId, companyIds);
    for (const companyId of companyIds) {
      if (!companyTasks.has(companyId)) companyTasks.set(companyId, new Set());
      companyTasks.get(companyId)!.add(taskId);
    }
  }

  const companyIds = [...companyTasks.keys()];
  const companies = await batchRead("companies", companyIds, COMPANY_PROPERTIES);
  const hiringById = new Map(hiringStore.companies.map((company) => [String(company.companyId), company]));
  const hiringByDomain = new Map(
    hiringStore.companies
      .map((company) => [domainKey(company.domain), company] as const)
      .filter(([key]) => Boolean(key)),
  );

  const scoped: MaritaScopedAccount[] = [];

  for (const company of companies) {
    const companyId = String(company.id);
    const properties = company.properties;
    const country = clean(properties.gtm_country) || clean(properties.country) || clean(properties.hs_country_code);
    const market = getTalenteraMarket(country);
    if (!market.eligible) continue;

    const domain = domainKey(properties.domain);
    const hiring = hiringById.get(companyId) || (domain ? hiringByDomain.get(domain) : undefined);
    const taskSet = companyTasks.get(companyId) || new Set<string>();
    const contactSet = companyContacts.get(companyId) || new Set<string>();

    scoped.push({
      companyId,
      name: clean(properties.name) || clean(hiring?.name) || domain || `Company ${companyId}`,
      domain: domain || domainKey(hiring?.domain),
      country: country || clean(hiring?.country),
      employeeCount: numberValue(properties.gtm_employee_count, properties.numberofemployees),
      industry: clean(properties.gtm_industry) || clean(properties.industry),
      careerPageUrl: clean(properties.career_page_url) || clean(hiring?.careerPageUrl),
      ats: clean(properties.detected_ats) || clean(hiring?.ats),
      activeJobs: Number(hiring?.activeJobs || 0),
      previousActiveJobs: Number(hiring?.previousActiveJobs || 0),
      newJobs7d: Number(hiring?.newJobs7d || 0),
      newJobs30d: Number(hiring?.newJobs30d || 0),
      closedJobs7d: Number(hiring?.closedJobs7d || 0),
      hiringScore: Number(hiring?.hiringScore || 0),
      topDepartments: hiring?.topDepartments || [],
      topLocations: hiring?.topLocations || [],
      jobs: (hiring?.jobs || [])
        .filter((job) => job.status === "active")
        .slice(0, 50)
        .map((job) => ({
          title: job.title,
          location: job.location,
          department: job.department,
          postedAt: job.postedAt,
        })),
      taskCount: taskSet.size,
      contactCount: contactSet.size,
      taskIds: [...taskSet],
      hubspotUrl: clean(hiring?.hubspotUrl) || hubspotCompanyUrl(companyId),
      atsStatus: clean(properties.ats_status),
      atsCategory: clean(properties.ats_category),
      atsConfidence: clean(properties.ats_confidence),
      hiringSignal: clean(properties.gtm_hiring_signal),
      reasonToReachOut: clean(properties.hs_reason_to_reach_out),
      existingCompanyTier: clean(properties.company_tier),
      sourceLastCheckedAt: clean(hiring?.lastCheckedAt),
      sourceLastSuccessfulCheckAt: clean(hiring?.lastSuccessfulCheckAt),
      sourceUrl: clean(hiring?.sourceUrl),
      hiringStatus: clean(hiring?.hiringStatus),
      trend: clean(hiring?.trend),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    taskCount: tasks.length,
    companyCountBeforeMarketFilter: companies.length,
    companies: scoped,
  };
}

export async function getMaritaExtensiveAccountScope(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && cache.value && cache.expiresAt > now) return cache.value;
  if (!options.force && cache.inflight) return cache.inflight;

  const inflight = buildScope()
    .then((value) => {
      cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    })
    .catch((error) => {
      cache.inflight = undefined;
      throw error;
    });

  cache = { ...cache, inflight };
  return inflight;
}

export const MARITA_EXTENSIVE_SCOPE = {
  ownerId: OWNER_ID,
  sourceLabel: SOURCE_LABEL,
  sourceDetail: SOURCE_DETAIL,
  cacheTtlMs: CACHE_TTL_MS,
} as const;
