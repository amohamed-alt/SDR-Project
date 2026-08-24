import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARITA_OWNER_ID = "31644369";
const EXTENSIVE_LIGHTER_SOURCE = "extensive-lighter";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const ARCHIVE_BATCH_SIZE = 100;
const MARKER_PATH = process.env.MARITA_EXTENSIVE_LIGHTER_CLEANUP_MARKER_PATH
  || "/app/data/cleanup-marita-extensive-lighter-no-phone-2026-08-25.json";

const inputSchema = z.object({
  execute: z.boolean().default(false),
});

type SkipReason =
  | "not_extensive_lighter"
  | "not_open_call"
  | "no_contact"
  | "missing_contact_record"
  | "contact_has_phone"
  | "task_has_phone";

type CleanupCounts = Record<SkipReason, number>;

function clean(value: unknown, max = 20_000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function workerAuthorized(request: Request) {
  const expected = clean(process.env.SIGNALHIRE_API_KEY, 1_000);
  const supplied = clean(request.headers.get("x-acquisition-worker-key"), 1_000);
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function getHubSpotToken() {
  const token = clean(process.env.HUBSPOT_PRIVATE_APP_TOKEN, 4_000);
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured in the production runtime.");
  return token;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function hasValue(value: unknown) {
  const normalized = clean(value, 500).toLowerCase();
  return Boolean(normalized && normalized !== "null" && normalized !== "undefined" && normalized !== "unassigned");
}

function stripNonPhoneNoise(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/[^\s<>"']+/gi, " ")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");
}

function containsPhoneLikeNumber(value: unknown) {
  const text = stripNonPhoneNoise(clean(value));
  const candidates = text.match(/(?:\+|00)?\d(?:[\s().-]*\d){6,14}/g) ?? [];

  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  });
}

function taskContainsPhone(task: HubSpotRecord) {
  const properties = task.properties;
  if (hasValue(properties.hs_task_contact_phone)) return true;
  return containsPhoneLikeNumber(`${clean(properties.hs_task_subject)}\n${clean(properties.hs_task_body)}`);
}

function isExtensiveLighterTask(task: HubSpotRecord) {
  const properties = task.properties;
  return clean(properties.hubspot_owner_id, 100) === MARITA_OWNER_ID
    && clean(properties.hs_object_source_label, 100).toUpperCase() === "INTEGRATION"
    && clean(properties.hs_object_source_detail_1, 200).toLowerCase() === EXTENSIVE_LIGHTER_SOURCE;
}

function isOpenCall(task: HubSpotRecord) {
  const properties = task.properties;
  return clean(properties.hs_task_type, 100).toUpperCase() === "CALL"
    && clean(properties.hs_task_status, 100).toUpperCase() !== "COMPLETED"
    && clean(properties.hs_task_is_open, 20).toLowerCase() === "true";
}

async function completedMarker() {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ MARKER_PATH, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function archiveTaskBatch(ids: string[]) {
  let lastError = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/tasks/batch/archive`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getHubSpotToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: ids.map((id) => ({ id })) }),
      cache: "no-store",
    });

    if (response.ok) return;

    lastError = (await response.text()).slice(0, 1_000);
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`HubSpot task archive failed (${response.status}): ${lastError}`);
    }

    const retryAfter = Number(response.headers.get("retry-after") || "0");
    const delayMs = retryAfter > 0 ? retryAfter * 1_000 : 750 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`HubSpot task archive failed after retries: ${lastError || "unknown error"}`);
}

function emptyCounts(): CleanupCounts {
  return {
    not_extensive_lighter: 0,
    not_open_call: 0,
    no_contact: 0,
    missing_contact_record: 0,
    contact_has_phone: 0,
    task_has_phone: 0,
  };
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Internal cleanup worker authorization failed." }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid cleanup request." }, { status: 400 });
  }

  if (parsed.data.execute) {
    const existing = await completedMarker();
    if (existing) {
      return NextResponse.json({
        status: "already_completed",
        marker: existing,
      }, { headers: { "Cache-Control": "no-store" } });
    }
  }

  const startedAt = new Date().toISOString();

  try {
    const tasks = await searchAll(
      "tasks",
      [
        "hubspot_owner_id",
        "hs_task_type",
        "hs_task_status",
        "hs_task_is_open",
        "hs_task_subject",
        "hs_task_body",
        "hs_task_contact_phone",
        "hs_object_source_label",
        "hs_object_source_detail_1",
      ],
      [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: MARITA_OWNER_ID },
        { propertyName: "hs_task_type", operator: "EQ", value: "CALL" },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
      ],
      ["hs_object_id"],
    );

    const skipped = emptyCounts();
    const sourceScoped: HubSpotRecord[] = [];

    for (const task of tasks) {
      if (!isExtensiveLighterTask(task)) {
        skipped.not_extensive_lighter += 1;
        continue;
      }
      if (!isOpenCall(task)) {
        skipped.not_open_call += 1;
        continue;
      }
      sourceScoped.push(task);
    }

    const taskContactAssociations = await readAssociations(
      "tasks",
      "contacts",
      sourceScoped.map((task) => task.id),
    );

    const contactIds = [...new Set(
      sourceScoped.flatMap((task) => taskContactAssociations.get(task.id) ?? []),
    )];

    const contacts = await batchRead("contacts", contactIds, ["phone", "mobilephone"]);
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const eligibleTaskIds: string[] = [];

    for (const task of sourceScoped) {
      const associatedContactIds = taskContactAssociations.get(task.id) ?? [];
      if (!associatedContactIds.length) {
        skipped.no_contact += 1;
        continue;
      }

      const associatedContacts = associatedContactIds.map((id) => contactsById.get(id));
      if (associatedContacts.some((contact) => !contact)) {
        skipped.missing_contact_record += 1;
        continue;
      }

      if (associatedContacts.some((contact) => hasValue(contact?.properties.phone) || hasValue(contact?.properties.mobilephone))) {
        skipped.contact_has_phone += 1;
        continue;
      }

      if (taskContainsPhone(task)) {
        skipped.task_has_phone += 1;
        continue;
      }

      eligibleTaskIds.push(task.id);
    }

    let archivedTasks = 0;
    if (parsed.data.execute) {
      for (const batch of chunks(eligibleTaskIds, ARCHIVE_BATCH_SIZE)) {
        await archiveTaskBatch(batch);
        archivedTasks += batch.length;
      }

      const marker = {
        version: "marita-extensive-lighter-no-phone-v1",
        ownerId: MARITA_OWNER_ID,
        source: EXTENSIVE_LIGHTER_SOURCE,
        completedAt: new Date().toISOString(),
        archivedTasks,
        eligibleTasks: eligibleTaskIds.length,
        sourceScopedTasks: sourceScoped.length,
        skipped,
      };

      await mkdir(/* turbopackIgnore: true */ dirname(MARKER_PATH), { recursive: true });
      await writeFile(/* turbopackIgnore: true */ MARKER_PATH, JSON.stringify(marker, null, 2), "utf8");
    }

    return NextResponse.json({
      status: parsed.data.execute ? "completed" : "dry_run",
      startedAt,
      completedAt: new Date().toISOString(),
      ownerId: MARITA_OWNER_ID,
      source: EXTENSIVE_LIGHTER_SOURCE,
      scannedMaritaOpenCalls: tasks.length,
      sourceScopedTasks: sourceScoped.length,
      eligibleTasks: eligibleTaskIds.length,
      archivedTasks,
      skipped,
      sampleEligibleTaskIds: eligibleTaskIds.slice(0, 20),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Marita Extensive Lighter cleanup failed", error);
    return NextResponse.json({
      status: "failed",
      startedAt,
      error: error instanceof Error ? error.message : "Unknown cleanup failure.",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
