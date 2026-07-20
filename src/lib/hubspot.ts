import type { HubSpotOwner, HubSpotRecord } from "@/lib/types";

const API_BASE = "https://api.hubapi.com";
const MAX_RETRIES = 4;
const SEARCH_PAGE_SIZE = 200;
const BATCH_SIZE = 100;
const ASSOCIATION_BATCH_SIZE = 500;
const MIN_REQUEST_INTERVAL_MS = Math.max(
  100,
  Number(process.env.HUBSPOT_MIN_REQUEST_INTERVAL_MS ?? "225") || 225,
);

let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

export interface SearchFilter {
  propertyName: string;
  operator: string;
  value?: string;
  highValue?: string;
  values?: string[];
}

interface SearchResponse {
  results: HubSpotRecord[];
  total: number;
  paging?: { next?: { after?: string } };
}

interface BatchResponse {
  results: HubSpotRecord[];
}

interface AssociationResponse {
  results: Array<{
    from: { id: string };
    to: Array<{ toObjectId: string }>;
  }>;
}

interface OwnersResponse {
  results: Array<{
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  }>;
  paging?: { next?: { after?: string } };
}

interface PipelinesResponse {
  results: Array<{
    id: string;
    label: string;
    stages: Array<{ id: string; label: string }>;
  }>;
}

export interface HubSpotPropertyDefinition {
  name: string;
  label: string;
  type: string;
  options?: Array<{ value: string; label: string; hidden?: boolean }>;
}

export class HubSpotApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: string,
  ) {
    super(message);
    this.name = "HubSpotApiError";
  }
}

function getToken() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new HubSpotApiError("HUBSPOT_PRIVATE_APP_TOKEN is not configured", 503, "Missing server environment variable");
  return token;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRequestSlot() {
  let release: (() => void) | undefined;
  const previous = requestQueue;
  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait > 0) await sleep(wait);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  } finally {
    release?.();
  }
}

function chunks<T>(items: T[], size = BATCH_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function compactErrorDetails(details: string) {
  if (!details) return "";
  try {
    const payload = JSON.parse(details) as {
      message?: string;
      category?: string;
      subCategory?: string;
      errors?: Array<{ message?: string }>;
    };
    return [
      payload.message,
      payload.category,
      payload.subCategory,
      payload.errors?.map((item) => item.message).filter(Boolean).join("; "),
    ].filter(Boolean).join(" · ").slice(0, 500);
  } catch {
    return details.replace(/\s+/g, " ").trim().slice(0, 500);
  }
}

export function describeHubSpotError(error: unknown) {
  if (error instanceof HubSpotApiError) {
    const details = compactErrorDetails(error.details);
    return `${error.message} (HTTP ${error.status})${details ? ` · ${details}` : ""}`;
  }
  return error instanceof Error ? error.message : "HubSpot request unavailable";
}

async function hubspotRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await waitForRequestSlot();
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        cache: "no-store",
      });

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      const body = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const delay = retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8_000, 750 * 2 ** attempt + Math.floor(Math.random() * 250));
        await sleep(delay);
        continue;
      }

      throw new HubSpotApiError(`HubSpot request failed: ${path}`, response.status, body.slice(0, 2_000));
    } catch (error) {
      lastError = error;
      if (error instanceof HubSpotApiError || attempt === MAX_RETRIES) throw error;
      await sleep(Math.min(8_000, 750 * 2 ** attempt + Math.floor(Math.random() * 250)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown HubSpot API error");
}

export async function searchAll(
  objectType: string,
  properties: readonly string[],
  filters: SearchFilter[],
  sorts: string[] = [],
): Promise<HubSpotRecord[]> {
  const records: HubSpotRecord[] = [];
  let after: string | undefined;

  do {
    const response = await hubspotRequest<SearchResponse>(`/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: filters.length ? [{ filters }] : [],
        properties,
        sorts,
        limit: SEARCH_PAGE_SIZE,
        ...(after ? { after } : {}),
      }),
    });

    records.push(...response.results);
    after = response.paging?.next?.after;

    if (after && Number(after) >= 10_000) {
      throw new HubSpotApiError(
        `HubSpot search exceeded the 10,000-record query limit: ${objectType}`,
        422,
        "Split the search into smaller owner or date partitions.",
      );
    }
  } while (after);

  return records;
}

export async function searchAllByPropertyValues(
  objectType: string,
  properties: readonly string[],
  partitionProperty: string,
  partitionValues: readonly string[],
  additionalFilters: SearchFilter[] = [],
  sorts: string[] = [],
): Promise<HubSpotRecord[]> {
  const records = new Map<string, HubSpotRecord>();

  for (const partitionValue of [...new Set(partitionValues)].filter(Boolean)) {
    const partitionRecords = await searchAll(
      objectType,
      properties,
      [{ propertyName: partitionProperty, operator: "EQ", value: partitionValue }, ...additionalFilters],
      sorts,
    );
    for (const record of partitionRecords) records.set(record.id, record);
  }

  return [...records.values()];
}

export async function batchRead(
  objectType: string,
  ids: string[],
  properties: readonly string[],
): Promise<HubSpotRecord[]> {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)];
  const responses = await Promise.all(
    chunks(uniqueIds).map((batch) =>
      hubspotRequest<BatchResponse>(`/crm/v3/objects/${objectType}/batch/read`, {
        method: "POST",
        body: JSON.stringify({
          archived: false,
          properties,
          inputs: batch.map((id) => ({ id })),
        }),
      }),
    ),
  );
  return responses.flatMap((response) => response.results);
}

export async function readAssociations(
  fromObjectType: string,
  toObjectType: string,
  fromIds: string[],
): Promise<Map<string, string[]>> {
  const associationMap = new Map<string, string[]>();
  if (!fromIds.length) return associationMap;

  const uniqueIds = [...new Set(fromIds)];
  for (const batch of chunks(uniqueIds, ASSOCIATION_BATCH_SIZE)) {
    const response = await hubspotRequest<AssociationResponse>(
      `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`,
      {
        method: "POST",
        body: JSON.stringify({ inputs: batch.map((id) => ({ id })) }),
      },
    );

    for (const item of response.results) {
      associationMap.set(item.from.id, item.to.map((target) => String(target.toObjectId)));
    }
  }

  return associationMap;
}

export async function listOwners(): Promise<HubSpotOwner[]> {
  const owners: HubSpotOwner[] = [];
  let after: string | undefined;

  do {
    const query = new URLSearchParams({ limit: "500", archived: "false" });
    if (after) query.set("after", after);
    const response = await hubspotRequest<OwnersResponse>(`/crm/v3/owners?${query.toString()}`);
    owners.push(
      ...response.results.map((owner) => ({
        id: String(owner.id),
        name: [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email || String(owner.id),
        email: owner.email,
      })),
    );
    after = response.paging?.next?.after;
  } while (after);

  return owners;
}

export async function listDealStages(): Promise<Map<string, string>> {
  const response = await hubspotRequest<PipelinesResponse>("/crm/v3/pipelines/deals");
  const stages = new Map<string, string>();
  for (const pipeline of response.results) {
    for (const stage of pipeline.stages) stages.set(stage.id, stage.label);
  }
  return stages;
}

export async function getPropertyDefinitions(
  objectType: string,
  propertyNames: readonly string[],
): Promise<HubSpotPropertyDefinition[]> {
  return Promise.all(
    propertyNames.map((propertyName) =>
      hubspotRequest<HubSpotPropertyDefinition>(
        `/crm/v3/properties/${objectType}/${encodeURIComponent(propertyName)}`,
      ),
    ),
  );
}

export interface CreateMeetingInput {
  contactId: string;
  ownerId: string;
  title: string;
  body: string;
  internalNotes: string;
  startAt: string;
  endAt: string;
  externalUrl: string;
  location: string;
}

export async function createMeeting(input: CreateMeetingInput): Promise<HubSpotRecord> {
  return hubspotRequest<HubSpotRecord>("/crm/v3/objects/meetings", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_timestamp: input.startAt,
        hubspot_owner_id: input.ownerId,
        hs_meeting_title: input.title,
        hs_meeting_body: input.body,
        hs_internal_meeting_notes: input.internalNotes,
        hs_meeting_external_url: input.externalUrl,
        hs_meeting_location: input.location,
        hs_meeting_start_time: input.startAt,
        hs_meeting_end_time: input.endAt,
        hs_meeting_outcome: "SCHEDULED",
      },
      associations: [{
        to: { id: input.contactId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 200 }],
      }],
    }),
  });
}

export async function archiveMeeting(meetingId: string): Promise<void> {
  await hubspotRequest<void>(`/crm/v3/objects/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" });
}
