import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { batchRead, readAssociations } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const taskReferenceSchema = z.object({
  id: z.string().regex(/^\d+$/),
  version: z.string().max(500).optional(),
});

const requestSchema = z.union([
  z.object({ tasks: z.array(taskReferenceSchema).max(500) }),
  z.object({ taskIds: z.array(z.string().regex(/^\d+$/)).max(500) }),
]);

const CONTACT_PROPERTIES = ["firstname", "lastname", "country", "company", "company_id"] as const;
const COMPANY_PROPERTIES = ["name", "country", "gtm_country"] as const;
const COUNTRY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const UNKNOWN_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_COUNTRY_CACHE_ENTRIES = 20_000;

type CountrySource = "contact" | "contact_company" | "task_company" | "unknown";

type TaskReference = {
  id: string;
  version: string;
};

type TaskCountryResult = {
  taskId: string;
  country: string;
  source: CountrySource;
  contactId?: string;
  contactName?: string;
  companyId?: string;
  companyName?: string;
};

type TaskCountryCacheEntry = {
  version: string;
  result: TaskCountryResult;
  expiresAt: number;
};

const globalState = globalThis as typeof globalThis & {
  __sdrTaskCountryCache?: Map<string, TaskCountryCacheEntry>;
};
const taskCountryCache = globalState.__sdrTaskCountryCache ?? new Map<string, TaskCountryCacheEntry>();
globalState.__sdrTaskCountryCache = taskCountryCache;

function value(record: HubSpotRecord | undefined, propertyName: string) {
  return record?.properties[propertyName]?.trim() ?? "";
}

function contactName(record: HubSpotRecord | undefined) {
  if (!record) return "";
  return [value(record, "firstname"), value(record, "lastname")].filter(Boolean).join(" ") || `Contact #${record.id}`;
}

function companyCountry(record: HubSpotRecord | undefined) {
  return value(record, "gtm_country") || value(record, "country");
}

function companyName(record: HubSpotRecord | undefined) {
  if (!record) return "";
  return value(record, "name") || `Company #${record.id}`;
}

function normalizeReferences(payload: z.infer<typeof requestSchema>): TaskReference[] {
  const references = "tasks" in payload
    ? payload.tasks.map((task) => ({ id: task.id, version: task.version ?? "" }))
    : payload.taskIds.map((id) => ({ id, version: "" }));

  const unique = new Map<string, TaskReference>();
  for (const reference of references) unique.set(reference.id, reference);
  return [...unique.values()];
}

function pruneCountryCache() {
  const now = Date.now();
  for (const [taskId, entry] of taskCountryCache) {
    if (entry.expiresAt <= now) taskCountryCache.delete(taskId);
  }

  if (taskCountryCache.size <= MAX_COUNTRY_CACHE_ENTRIES) return;
  const overflow = taskCountryCache.size - MAX_COUNTRY_CACHE_ENTRIES;
  const oldest = [...taskCountryCache.entries()]
    .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
    .slice(0, overflow);
  for (const [taskId] of oldest) taskCountryCache.delete(taskId);
}

async function resolveTaskCountries(taskIds: string[]): Promise<TaskCountryResult[]> {
  if (!taskIds.length) return [];

  const [taskContacts, taskCompanies] = await Promise.all([
    readAssociations("tasks", "contacts", taskIds),
    readAssociations("tasks", "companies", taskIds),
  ]);

  const contactIds = [...new Set([...taskContacts.values()].flat())];
  const [contacts, contactCompanies] = await Promise.all([
    batchRead("contacts", contactIds, CONTACT_PROPERTIES),
    readAssociations("contacts", "companies", contactIds),
  ]);

  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const companyIds = new Set<string>([...taskCompanies.values()].flat());

  for (const contact of contacts) {
    const primaryCompanyId = value(contact, "company_id");
    if (primaryCompanyId) companyIds.add(primaryCompanyId);
    for (const companyId of contactCompanies.get(contact.id) ?? []) companyIds.add(companyId);
  }

  const companies = await batchRead("companies", [...companyIds], COMPANY_PROPERTIES);
  const companyMap = new Map(companies.map((company) => [company.id, company]));

  return taskIds.map((taskId) => {
    const associatedContactIds = taskContacts.get(taskId) ?? [];

    for (const contactId of associatedContactIds) {
      const contact = contactMap.get(contactId);
      const country = value(contact, "country");
      if (country) {
        const primaryCompanyId = value(contact, "company_id") || (contactCompanies.get(contactId) ?? [])[0];
        const company = primaryCompanyId ? companyMap.get(primaryCompanyId) : undefined;
        return {
          taskId,
          country,
          source: "contact",
          contactId,
          contactName: contactName(contact),
          ...(primaryCompanyId ? { companyId: primaryCompanyId } : {}),
          ...(company ? { companyName: companyName(company) } : {}),
        };
      }
    }

    for (const contactId of associatedContactIds) {
      const contact = contactMap.get(contactId);
      const candidateCompanyIds = [
        value(contact, "company_id"),
        ...(contactCompanies.get(contactId) ?? []),
      ].filter(Boolean);

      for (const companyId of candidateCompanyIds) {
        const company = companyMap.get(companyId);
        const country = companyCountry(company);
        if (country) {
          return {
            taskId,
            country,
            source: "contact_company",
            contactId,
            contactName: contactName(contact),
            companyId,
            companyName: companyName(company),
          };
        }
      }
    }

    for (const companyId of taskCompanies.get(taskId) ?? []) {
      const company = companyMap.get(companyId);
      const country = companyCountry(company);
      if (country) {
        return {
          taskId,
          country,
          source: "task_company",
          companyId,
          companyName: companyName(company),
        };
      }
    }

    const fallbackContactId = associatedContactIds[0];
    const fallbackCompanyId = (taskCompanies.get(taskId) ?? [])[0];
    const fallbackContact = fallbackContactId ? contactMap.get(fallbackContactId) : undefined;
    const fallbackCompany = fallbackCompanyId ? companyMap.get(fallbackCompanyId) : undefined;

    return {
      taskId,
      country: "Unknown",
      source: "unknown",
      ...(fallbackContactId ? { contactId: fallbackContactId, contactName: contactName(fallbackContact) } : {}),
      ...(fallbackCompanyId ? { companyId: fallbackCompanyId, companyName: companyName(fallbackCompany) } : {}),
    };
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join(" · ") || "The request payload is invalid";
    return NextResponse.json(
      { error: "Invalid task country lookup request", details },
      { status: 400 },
    );
  }

  const references = normalizeReferences(parsed.data);
  if (!references.length) return NextResponse.json({ tasks: [] satisfies TaskCountryResult[] });

  try {
    pruneCountryCache();
    const now = Date.now();
    const results = new Map<string, TaskCountryResult>();
    const misses: TaskReference[] = [];

    for (const reference of references) {
      const cached = taskCountryCache.get(reference.id);
      if (cached && cached.expiresAt > now && cached.version === reference.version) {
        results.set(reference.id, cached.result);
      } else {
        misses.push(reference);
      }
    }

    const resolved = await resolveTaskCountries(misses.map((reference) => reference.id));
    const versionMap = new Map(misses.map((reference) => [reference.id, reference.version]));

    for (const result of resolved) {
      results.set(result.taskId, result);
      taskCountryCache.set(result.taskId, {
        version: versionMap.get(result.taskId) ?? "",
        result,
        expiresAt: Date.now() + (result.source === "unknown" ? UNKNOWN_CACHE_TTL_MS : COUNTRY_CACHE_TTL_MS),
      });
    }

    const tasks = references.map((reference) => results.get(reference.id) ?? {
      taskId: reference.id,
      country: "Unknown",
      source: "unknown" as const,
    });

    return NextResponse.json(
      { tasks },
      {
        headers: {
          "Cache-Control": "private, max-age=0, must-revalidate",
          "X-Task-Country-Cache-Hits": String(references.length - misses.length),
          "X-Task-Country-Cache-Misses": String(misses.length),
        },
      },
    );
  } catch (error) {
    console.error("Task country lookup failed", error);
    return NextResponse.json(
      {
        error: "Unable to resolve task countries from HubSpot associations",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
