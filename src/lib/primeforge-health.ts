import {
  APPROVED_SENDING_DOMAINS,
  EXPECTED_MAILBOXES_PER_DOMAIN,
  EXPECTED_SENDING_MAILBOXES,
} from "./smartlead-sender-routing.ts";

const PRIMEFORGE_API = "https://api.primeforge.ai/public";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

type JsonObject = Record<string, unknown>;
type FetchLike = typeof fetch;

type PrimeforgeDomain = {
  id: string;
  workspaceId: string;
  domain: string;
  status: string;
  platform: string;
  ready: boolean;
};

type PrimeforgeMailbox = {
  id: string;
  domain: string;
  status: string;
  ready: boolean;
};

export type PrimeforgeDomainHealth = {
  domain: string;
  found: boolean;
  ready: boolean;
  status: string;
  platform: string;
  mailboxes: number;
  readyMailboxes: number;
  dns: { spf: boolean; dkim: boolean; dmarc: boolean };
  warnings: string[];
};

export type PrimeforgeHealth = {
  configured: boolean;
  healthy: boolean;
  checkedAt: string;
  expectedDomains: number;
  expectedMailboxes: number;
  readyMailboxes: number;
  workspaces: number;
  domains: PrimeforgeDomainHealth[];
  warnings: string[];
};

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalized(value: unknown) {
  return clean(value).toLowerCase();
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function boolLike(value: unknown) {
  if (value === true || value === 1 || normalized(value) === "true") return true;
  if (value === false || value === 0 || normalized(value) === "false") return false;
  return null;
}

function rows(value: unknown, keys: string[]) {
  if (Array.isArray(value)) return value;
  const root = object(value);
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const data = object(root.data);
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  return [] as unknown[];
}

function paginationTotal(value: unknown) {
  const root = object(value);
  const pagination = object(root.pagination || object(root.data).pagination);
  for (const candidate of [pagination.total, pagination.totalCount, root.total, object(root.data).total]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function domainNameFrom(value: unknown) {
  const item = object(value);
  const nested = object(item.domain);
  return normalized(
    typeof item.domain === "string"
      ? item.domain
      : item.domainName || item.domain_name || item.name || nested.domain || nested.name,
  );
}

function resourceStatus(item: JsonObject) {
  return normalized(
    item.detailedStatus
      || item.detailed_status
      || item.provisioningStatus
      || item.provisioning_status
      || item.connectionStatus
      || item.connection_status
      || item.status,
  );
}

function statusIsReady(status: string) {
  return /^(?:active|ready|completed|complete|provisioned|success|succeeded|connected)$/.test(status);
}

function statusIsBad(status: string) {
  return /(?:fail|error|invalid|suspend|cancel|delete|block|disconnect|expired)/.test(status);
}

function workspaceIdFrom(value: unknown) {
  const item = object(value);
  const workspace = object(item.workspace);
  return clean(item.workspaceId || item.workspace_id || workspace.id);
}

function workspaceRecordId(value: unknown) {
  const item = object(value);
  return clean(item.id || item.workspaceId || item.workspace_id);
}

function parseDomain(value: unknown, fallbackWorkspaceId = ""): PrimeforgeDomain | null {
  const item = object(value);
  const domain = domainNameFrom(item);
  if (!domain) return null;
  const status = resourceStatus(item);
  const failedReason = clean(item.failedReason || item.failed_reason);
  return {
    id: clean(item.id || item.domainId || item.domain_id),
    workspaceId: workspaceIdFrom(item) || fallbackWorkspaceId,
    domain,
    status,
    platform: normalized(item.platform || item.provider),
    ready: statusIsReady(status) && !statusIsBad(status) && !failedReason,
  };
}

function parseMailbox(value: unknown): PrimeforgeMailbox | null {
  const item = object(value);
  let domain = domainNameFrom(item);
  const email = normalized(item.email || item.emailAddress || item.email_address || item.address || item.mailbox);
  if (!domain && email.includes("@")) domain = email.split("@").pop() || "";
  if (!domain) return null;
  const status = resourceStatus(item);
  const deleted = boolLike(item.deleted || item.isDeleted || item.is_deleted) === true
    || /(?:deleted|deleting)/.test(normalized(item.deletionState || item.deletion_state));
  return {
    id: clean(item.id || item.mailboxId || item.mailbox_id || email),
    domain,
    status,
    ready: statusIsReady(status) && !statusIsBad(status) && !deleted,
  };
}

function dnsFlags(value: unknown) {
  const records = rows(value, ["results", "records", "dnsRecords", "dns_records", "items"]);
  let spf = false;
  let dkim = false;
  let dmarc = false;
  for (const value of records) {
    const record = object(value);
    const name = normalized(record.name || record.host || record.hostName || record.hostname);
    const content = normalized(record.content || record.value || record.address || record.target);
    if (/v=spf1/.test(content)) spf = true;
    if (/_domainkey/.test(name) || /(?:^|\s)p=[a-z0-9+/=]{24,}/i.test(content)) dkim = true;
    if (/_dmarc/.test(name) || /v=dmarc1/.test(content)) dmarc = true;
  }
  return { spf, dkim, dmarc };
}

async function primeforgeRequest(fetchImpl: FetchLike, apiKey: string, endpoint: string, query: Record<string, string> = {}) {
  const url = new URL(`${PRIMEFORGE_API}${endpoint}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: apiKey, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (response.ok) return await response.json() as unknown;
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
        continue;
      }
      throw new Error(`Primeforge read-only API ${endpoint} failed with HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Primeforge read-only API request failed.");
}

async function listAll(
  fetchImpl: FetchLike,
  apiKey: string,
  endpoint: string,
  keys: string[],
  query: Record<string, string> = {},
) {
  const all: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const payload = await primeforgeRequest(fetchImpl, apiKey, endpoint, {
      ...query,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const batch = rows(payload, keys);
    all.push(...batch);
    const total = paginationTotal(payload);
    if (batch.length < PAGE_SIZE || (total !== null && all.length >= total)) break;
  }
  return all;
}

export async function checkPrimeforgeInfrastructure(options: { apiKey?: string; fetchImpl?: FetchLike } = {}): Promise<PrimeforgeHealth> {
  const apiKey = clean(options.apiKey || process.env.PRIMEFORGE_API_KEY, 8_000);
  const checkedAt = new Date().toISOString();
  const approvedDomains = [...APPROVED_SENDING_DOMAINS.talentera, ...APPROVED_SENDING_DOMAINS.evalify];
  const approvedDomainSet = new Set<string>(approvedDomains);
  if (!apiKey) {
    return {
      configured: false,
      healthy: false,
      checkedAt,
      expectedDomains: approvedDomains.length,
      expectedMailboxes: EXPECTED_SENDING_MAILBOXES,
      readyMailboxes: 0,
      workspaces: 0,
      domains: [],
      warnings: ["PRIMEFORGE_API_KEY is not configured."],
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const workspaceRows = await listAll(fetchImpl, apiKey, "/workspaces", ["results", "workspaces", "items"]);
  const workspaceIds = [...new Set(workspaceRows.map(workspaceRecordId).filter(Boolean))];

  // Primeforge scopes inventory endpoints by workspace. An authenticated unscoped
  // request may return an empty list even when the workspace contains resources.
  const domainRowsByWorkspace = await Promise.all(workspaceIds.map(async (workspaceId) => ({
    workspaceId,
    rows: await listAll(
      fetchImpl,
      apiKey,
      "/domains",
      ["results", "domains", "items"],
      { workspaceId },
    ),
  })));
  const parsedDomains = domainRowsByWorkspace.flatMap(({ workspaceId, rows: domainRows }) => (
    domainRows
      .map((row) => parseDomain(row, workspaceId))
      .filter((item): item is PrimeforgeDomain => Boolean(item))
  ));

  const approvedDomainResources = parsedDomains.filter((item) => approvedDomainSet.has(item.domain));
  const mailboxRows = (await Promise.all(approvedDomainResources.map((domain) => listAll(
    fetchImpl,
    apiKey,
    "/mailboxes",
    ["results", "mailboxes", "items"],
    { workspaceId: domain.workspaceId, domainId: domain.id },
  )))).flat();
  const parsedMailboxes = mailboxRows.map(parseMailbox).filter((item): item is PrimeforgeMailbox => Boolean(item));
  const uniqueMailboxes = [...new Map(parsedMailboxes.map((item) => [item.id || `${item.domain}:${item.status}`, item])).values()];
  const domains: PrimeforgeDomainHealth[] = [];

  for (const domain of approvedDomains) {
    const matches = parsedDomains.filter((item) => item.domain === domain);
    const resource = matches[0];
    const mailboxes = uniqueMailboxes.filter((item) => item.domain === domain);
    const readyMailboxes = mailboxes.filter((item) => item.ready).length;
    const warnings: string[] = [];
    let dns = { spf: false, dkim: false, dmarc: false };

    if (!resource) warnings.push("Domain is missing from Primeforge.");
    else {
      if (matches.length !== 1) warnings.push(`Primeforge returned ${matches.length} records for this domain.`);
      if (!resource.ready) warnings.push(`Domain is not explicitly ready (status: ${resource.status || "unknown"}).`);
      if (!resource.id) warnings.push("Domain ID is missing, so DNS cannot be verified.");
      else {
        try {
          dns = dnsFlags(await primeforgeRequest(
            fetchImpl,
            apiKey,
            `/domains/${encodeURIComponent(resource.id)}/dns`,
            { workspaceId: resource.workspaceId },
          ));
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Primeforge DNS read failed.");
        }
      }
    }

    if (!dns.spf) warnings.push("SPF is not visible in Primeforge DNS.");
    if (!dns.dkim) warnings.push("DKIM is not visible in Primeforge DNS.");
    if (!dns.dmarc) warnings.push("DMARC is not visible in Primeforge DNS.");
    if (mailboxes.length !== EXPECTED_MAILBOXES_PER_DOMAIN) warnings.push(`Mailbox inventory is ${mailboxes.length}/${EXPECTED_MAILBOXES_PER_DOMAIN}.`);
    if (readyMailboxes !== EXPECTED_MAILBOXES_PER_DOMAIN) warnings.push(`Ready mailbox inventory is ${readyMailboxes}/${EXPECTED_MAILBOXES_PER_DOMAIN}.`);

    domains.push({
      domain,
      found: Boolean(resource),
      ready: Boolean(resource?.ready) && warnings.length === 0,
      status: resource?.status || "missing",
      platform: resource?.platform || "unknown",
      mailboxes: mailboxes.length,
      readyMailboxes,
      dns,
      warnings,
    });
  }

  const warnings = domains.flatMap((item) => item.warnings.map((warning) => `${item.domain}: ${warning}`));
  const readyMailboxes = domains.reduce((sum, item) => sum + item.readyMailboxes, 0);
  if (!workspaceRows.length) warnings.push("Primeforge returned no accessible workspaces.");
  else if (!workspaceIds.length) warnings.push("Primeforge workspaces are missing IDs, so scoped inventory cannot be verified.");
  if (readyMailboxes !== EXPECTED_SENDING_MAILBOXES) warnings.push(`Primeforge ready mailbox inventory is ${readyMailboxes}/${EXPECTED_SENDING_MAILBOXES}.`);

  return {
    configured: true,
    healthy: warnings.length === 0,
    checkedAt,
    expectedDomains: approvedDomains.length,
    expectedMailboxes: EXPECTED_SENDING_MAILBOXES,
    readyMailboxes,
    workspaces: workspaceRows.length,
    domains,
    warnings,
  };
}
