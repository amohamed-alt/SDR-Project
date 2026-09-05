const DATA_API_URL = (process.env.DASHBOARD_CACHE_API_URL || "").replace(/\/$/, "");
const READ_TIMEOUT_MS = Number(process.env.DASHBOARD_CACHE_READ_TIMEOUT_MS || 700);
const WRITE_TIMEOUT_MS = Math.max(2_000, Number(process.env.DASHBOARD_CACHE_WRITE_TIMEOUT_MS || 2_000));

export type AcquisitionAccount = {
  domain: string;
  name: string;
  source: string;
  sourceId: string;
  country: string;
  employeeCount: number;
  industry: string;
  activeJobs: number;
  headcountGrowth: number;
  hrHeadcount: number;
  careerPageUrl: string;
  detectedAts: string;
  gtmScore: number;
  gtmTier: "A" | "B" | "C" | "Watch";
  fitScore: number;
  intentScore: number;
  atsOpportunityScore: number;
  exclusionStatus: "eligible" | "excluded" | "review";
  exclusionReason: string;
  hubspotCompanyId: string;
  status: "candidate" | "qualified" | "people_ready" | "enriched" | "pushed" | "excluded" | "existing_hubspot";
  primaryPersona: string;
  secondaryPersona: string;
  economicBuyer: string;
  technicalInfluencer: string;
  strongestSignal: string;
  recommendedAngle: string;
  assignedOwnerId: string;
  assignedOwnerName: string;
  evidence: Record<string, unknown>;
  peopleCount?: number;
  enrichedCount?: number;
  phoneReadyCount?: number;
  pushCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AcquisitionPerson = {
  uid: string;
  accountDomain: string;
  fullName: string;
  title: string;
  currentCompany: string;
  location: string;
  linkedinUrl: string;
  rankScore: number;
  fitReason: string;
  emails: string[];
  phones: string[];
  enrichmentStatus: "search_only" | "enriched" | "failed";
  selected: boolean;
  meta: Record<string, unknown>;
  updatedAt?: string;
};

export function acquisitionAccountWritePayload(account: AcquisitionAccount) {
  const writePayload = { ...account };
  delete writePayload.peopleCount;
  delete writePayload.enrichedCount;
  delete writePayload.phoneReadyCount;
  delete writePayload.pushCount;
  delete writePayload.createdAt;
  delete writePayload.updatedAt;
  return writePayload;
}

export function acquisitionPersonWritePayload(person: AcquisitionPerson) {
  const writePayload = { ...person };
  delete writePayload.updatedAt;
  return writePayload;
}

function assertConfigured() {
  if (!DATA_API_URL) throw new Error("Dashboard data API is not configured.");
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = READ_TIMEOUT_MS): Promise<T> {
  assertConfigured();
  const response = await fetch(`${DATA_API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Acquisition data API ${path} failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return await response.json() as T;
}

export async function listAcquisitionAccounts(filters: {
  limit?: number;
  status?: string;
  country?: string;
  tier?: string;
  includeExcluded?: boolean;
} = {}) {
  const query = new URLSearchParams();
  query.set("limit", String(Math.min(1000, Math.max(1, filters.limit ?? 300))));
  if (filters.status) query.set("status", filters.status);
  if (filters.country) query.set("country", filters.country);
  if (filters.tier) query.set("tier", filters.tier);
  if (filters.includeExcluded) query.set("include_excluded", "true");
  return request<{
    database: string;
    generatedAt: number;
    summary: Record<string, number>;
    accounts: AcquisitionAccount[];
  }>(`/v1/acquisition/accounts?${query.toString()}`);
}

export async function upsertAcquisitionAccounts(accounts: AcquisitionAccount[]) {
  if (!accounts.length) return { status: "stored", accounts: 0 };
  return request<{ status: string; accounts: number }>("/v1/acquisition/accounts", {
    method: "PUT",
    body: JSON.stringify({ accounts: accounts.map(acquisitionAccountWritePayload) }),
  }, Math.max(WRITE_TIMEOUT_MS, 10_000));
}

export async function listAcquisitionPeople(domain: string) {
  return request<{ domain: string; people: AcquisitionPerson[] }>(
    `/v1/acquisition/accounts/${encodeURIComponent(domain)}/people`,
  );
}

export async function upsertAcquisitionPeople(people: AcquisitionPerson[]) {
  if (!people.length) return { status: "stored", people: 0 };
  return request<{ status: string; people: number }>("/v1/acquisition/people", {
    method: "PUT",
    body: JSON.stringify({ people: people.map(acquisitionPersonWritePayload) }),
  }, Math.max(WRITE_TIMEOUT_MS, 10_000));
}

export async function writeAcquisitionPush(input: {
  accountDomain: string;
  personUid: string;
  hubspotCompanyId: string;
  hubspotContactId: string;
  hubspotTaskId: string;
  ownerId: string;
  ownerName: string;
  status: string;
  snapshot: Record<string, unknown>;
}) {
  return request<{ status: string; id: number; pushedAt: string }>("/v1/acquisition/pushes", {
    method: "POST",
    body: JSON.stringify(input),
  }, Math.max(WRITE_TIMEOUT_MS, 10_000));
}
