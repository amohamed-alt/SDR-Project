import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maqsamAgentKey } from "../src/lib/maqsam-agent.mjs";

const MAQSAM_API_URL = "https://api.mq.maqsam.com/v3/calls";
const DEFAULT_TARGET_AGENT_EMAIL = "m.chedid@bayt.net";
const DEFAULT_DASHBOARD_URL = "http://sdr-dashboard:3000";

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function numberEnv(name, fallback) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const config = {
  dashboardBaseUrl: env("SDR_DASHBOARD_INTERNAL_URL", env("SDR_DASHBOARD_BASE_URL", DEFAULT_DASHBOARD_URL)).replace(/\/+$/, ""),
  ingestSecret: env("MAQSAM_INGEST_SECRET"),
  maqsamBasicAuth: env("MAQSAM_BASIC_AUTH"),
  maqsamAccessKey: env("MAQSAM_ACCESS_KEY"),
  maqsamAccessSecret: env("MAQSAM_ACCESS_SECRET"),
  hubspotToken: env("HUBSPOT_PRIVATE_APP_TOKEN"),
  danielAgentEmail: env("MAQSAM_DANIEL_AGENT_EMAIL").toLowerCase(),
  backfillFrom: env("MAQSAM_BACKFILL_FROM", "2026-09-07"),
  checkpointPath: env("MAQSAM_SYNC_CHECKPOINT_PATH", "/app/data/maqsam-sync-checkpoint.json"),
  targetAgentEmail: env("MAQSAM_TARGET_AGENT_EMAIL", DEFAULT_TARGET_AGENT_EMAIL).toLowerCase(),
  intervalMs: numberEnv("MAQSAM_SYNC_INTERVAL_SECONDS", 600) * 1000,
  lookbackSeconds: numberEnv("MAQSAM_SYNC_LOOKBACK_SECONDS", 3 * 60 * 60),
  pageCount: Math.min(50, Math.max(1, numberEnv("MAQSAM_SYNC_PAGE_COUNT", 12))),
};

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function authHeader() {
  if (config.maqsamBasicAuth) {
    return config.maqsamBasicAuth.toLowerCase().startsWith("basic ")
      ? config.maqsamBasicAuth
      : `Basic ${config.maqsamBasicAuth}`;
  }

  if (config.maqsamAccessKey && config.maqsamAccessSecret) {
    return `Basic ${Buffer.from(`${config.maqsamAccessKey}:${config.maqsamAccessSecret}`).toString("base64")}`;
  }

  throw new Error("Set MAQSAM_BASIC_AUTH or MAQSAM_ACCESS_KEY + MAQSAM_ACCESS_SECRET.");
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "").replace(/^00/, "");
}

const dialingPlans = [
  ["971", [9]], ["966", [9]], ["974", [8]], ["965", [8]], ["973", [8]],
  ["968", [8]], ["962", [9]], ["961", [7, 8]], ["964", [10]], ["970", [9]],
  ["972", [9]], ["967", [9]], ["249", [9]], ["212", [9]], ["213", [9]],
  ["216", [8]], ["218", [9]], ["20", [10]], ["91", [10]], ["92", [10]],
  ["880", [10]], ["86", [11]], ["90", [10]], ["98", [10]], ["44", [10]], ["1", [10]],
];

function phoneParts(value) {
  const full = digits(value);
  let countryCode = "";
  let national = "";

  for (const [country, validLengths] of dialingPlans) {
    if (!full.startsWith(country)) continue;
    const remainder = full.slice(country.length);
    if (validLengths.includes(remainder.length)) {
      countryCode = country;
      national = remainder;
      break;
    }
  }

  if (!national) national = full.length > 10 ? full.slice(-9) : full.replace(/^0/, "");

  const variants = [...new Set([
    full,
    national,
    national.startsWith("0") ? national.slice(1) : `0${national}`,
    full.slice(-10),
    full.slice(-9),
    full.slice(-8),
  ].filter((item) => item && item.length >= 7))];

  return { full, countryCode, national, variants, last9: full.slice(-9), last8: full.slice(-8) };
}

function getPhone(call) {
  const type = String(call.type ?? "").toLowerCase();
  if (type === "inbound") return call.callerNumber || call.caller || "";
  if (type === "outbound" || type === "campaign") return call.calleeNumber || call.callee || "";
  return call.calleeNumber || call.callerNumber || call.callee || call.caller || "";
}

function extractSummary(summary) {
  if (!summary) return { text: "", language: "" };
  if (typeof summary === "string") return { text: summary.trim(), language: "" };
  if (typeof summary === "object" && !Array.isArray(summary)) {
    for (const language of ["en", "ar"]) {
      const text = String(summary[language] ?? "").trim();
      if (text) return { text, language };
    }
    for (const [language, value] of Object.entries(summary)) {
      const text = String(value ?? "").trim();
      if (text) return { text, language };
    }
  }
  return { text: "", language: "" };
}

export function targetAgentForCall(call, identities = { maritaEmail: config.targetAgentEmail, danielEmail: config.danielAgentEmail }) {
  const agents = Array.isArray(call.agents) ? call.agents : [];
  return agents.find((agent) => maqsamAgentKey(agent, identities) !== "unknown");
}

export function isEligibleCall(call) {
  // Counts include unanswered calls and calls without an AI summary.
  return String(call.type ?? "").toLowerCase() !== "internal";
}

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  return body;
}

export async function fetchCalls(startTime, endTime, authorization = authHeader(), pageCount = config.pageCount) {
  const output = new Map();

  for (let page = 1; page <= pageCount; page += 1) {
    const url = new URL(MAQSAM_API_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("end_time", String(endTime));

    const payload = await fetchJson(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
    });

    if (!Array.isArray(payload.message)) throw new Error("Unexpected Maqsam calls response; refusing to advance history checkpoint.");
    const calls = payload.message;
    if (!calls.length) return [...output.values()];
    let added = 0;
    for (const call of calls) {
      const key = String(call?.id ?? call?.referenceId ?? "").trim();
      if (key && !output.has(key)) { output.set(key, call); added += 1; }
    }
    if (!added) throw new Error("Maqsam pagination did not advance; refusing to skip history.");
  }

  throw new Error("Maqsam page limit reached; increase MAQSAM_SYNC_PAGE_COUNT before advancing history.");
}

function scoreCandidate(callPhone, contact) {
  const properties = contact?.properties ?? {};
  const candidateValues = [
    properties.phone,
    properties.mobilephone,
    properties.hs_searchable_calculated_phone_number,
    properties.hs_searchable_calculated_mobile_number,
  ].filter(Boolean);

  let best = 0;
  for (const rawCandidate of candidateValues) {
    const candidate = phoneParts(rawCandidate);
    if (candidate.full && candidate.full === callPhone.full) best = Math.max(best, 100);
    if (candidate.national && callPhone.national && candidate.national === callPhone.national) best = Math.max(best, 95);
    if (callPhone.national?.length >= 9 && candidate.full.length >= 9 && candidate.last9 === callPhone.national.slice(-9)) best = Math.max(best, 90);
    if (callPhone.national?.length === 8 && candidate.full.length >= 8 && candidate.last8 === callPhone.national) best = Math.max(best, 90);
    if (callPhone.variants.some((variant) => variant.length >= 8 && (candidate.full === variant || candidate.full.endsWith(variant)))) best = Math.max(best, 85);
  }
  return best;
}

async function resolveHubspotContact(callPhone) {
  if (!config.hubspotToken || !callPhone.national || callPhone.national.length < 7) {
    return { matchStatus: "unmatched", hubspotNoteStatus: "not_applicable" };
  }

  const payload = await fetchJson("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.hubspotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: callPhone.national,
      properties: ["firstname", "lastname", "email", "phone", "mobilephone", "hs_searchable_calculated_phone_number", "hs_searchable_calculated_mobile_number"],
      limit: 100,
    }),
  });

  const ranked = (Array.isArray(payload.results) ? payload.results : [])
    .map((contact) => ({ contact, score: scoreCandidate(callPhone, contact) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) return { matchStatus: "unmatched", hubspotNoteStatus: "not_applicable" };

  const topScore = ranked[0].score;
  const top = ranked.filter((entry) => entry.score === topScore);
  if (top.length !== 1) {
    return { matchStatus: "ambiguous", hubspotNoteStatus: "not_applicable", contactMatchScore: topScore };
  }

  const contact = top[0].contact;
  const properties = contact.properties ?? {};
  return {
    matchStatus: "matched",
    hubspotNoteStatus: "pending",
    hubspotContactId: String(contact.id),
    contactName: [properties.firstname, properties.lastname].filter(Boolean).join(" ").trim(),
    contactEmail: properties.email || undefined,
    contactPhone: properties.phone || undefined,
    contactMobilePhone: properties.mobilephone || undefined,
    contactMatchScore: topScore,
  };
}

async function upsertDashboardCall(record) {
  return fetchJson(`${config.dashboardBaseUrl}/api/maqsam/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-maqsam-ingest-secret": required(config.ingestSecret, "MAQSAM_INGEST_SECRET is missing."),
    },
    body: JSON.stringify(record),
  });
}

async function syncOnce(startTime, endTime) {
  const calls = await fetchCalls(startTime, endTime);
  const existingPayload = await fetchJson(`${config.dashboardBaseUrl}/api/maqsam/calls?from=${new Date(startTime * 1000).toISOString().slice(0, 10)}&to=${new Date(endTime * 1000).toISOString().slice(0, 10)}&limit=5000`);
  const existing = new Map((existingPayload.calls ?? []).map((record) => [record.callKey, record]));
  let ready = 0;
  let upserted = 0;
  let skipped = 0;

  for (const call of calls) {
    const targetAgent = targetAgentForCall(call);
    if (!targetAgent || !isEligibleCall(call)) {
      skipped += 1;
      continue;
    }

    const { text: summary, language: summaryLanguage } = extractSummary(call.summary);

    const callKey = String(call.id ?? call.referenceId ?? "").trim();
    const timestampSeconds = Number(call.timestamp);
    const timestampMs = Number.isFinite(timestampSeconds) && timestampSeconds > 0 ? timestampSeconds * 1000 : Date.now();
    const phoneRaw = getPhone(call);
    const phone = phoneParts(phoneRaw);

    if (!callKey || phone.full.length < 7) {
      skipped += 1;
      continue;
    }

    ready += 1;
    const previous = existing.get(callKey);
    const match = previous?.matchStatus === "matched" ? {
      matchStatus: previous.matchStatus, hubspotContactId: previous.hubspotContactId,
      contactName: previous.contactName, contactEmail: previous.contactEmail,
      contactPhone: previous.contactPhone, contactMobilePhone: previous.contactMobilePhone,
      contactMatchScore: previous.contactMatchScore, hubspotNoteStatus: previous.hubspotNoteStatus,
      hubspotNoteId: previous.hubspotNoteId,
    } : await resolveHubspotContact(phone).catch((error) => {
      console.warn(`HubSpot match failed for call ${callKey}: ${error.message}`);
      return { matchStatus: "unmatched", hubspotNoteStatus: "not_applicable" };
    });

    await upsertDashboardCall({
      callKey,
      callId: call.id ?? null,
      referenceId: call.referenceId ?? null,
      agentEmail: String(targetAgent?.email ?? config.targetAgentEmail),
      agentName: String(targetAgent?.name ?? ""),
      phone: String(phoneRaw),
      direction: String(call.type ?? ""),
      state: String(call.state ?? ""),
      timestamp: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
      noteTimestamp: new Date(timestampMs).toISOString(),
      durationSeconds: Number(call.duration ?? 0),
      ringingTimeSeconds: Number(call.ringingTime ?? 0),
      holdTimeSeconds: Number(call.holdTime ?? 0),
      waitingTimeSeconds: Number(call.waitingTime ?? 0),
      handlingTimeSeconds: Number(call.handlingTime ?? 0),
      summary: summary || previous?.summary || "",
      summaryLanguage: summaryLanguage || previous?.summaryLanguage || "",
      transcription: String(call.transcription || previous?.transcription || ""),
      segments: Array.isArray(call.segments) && call.segments.length ? call.segments : previous?.segments ?? [],
      sentiment: String(call.sentiment ?? ""),
      tags: [...(Array.isArray(call.tags) ? call.tags : []), ...(Array.isArray(call.autoTags) ? call.autoTags : [])],
      ...match,
    });
    upserted += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(`Maqsam sync: fetched=${calls.length}; ready=${ready}; upserted=${upserted}; skipped=${skipped}`);
}

async function readCheckpoint() {
  const startTime = Date.parse(`${config.backfillFrom}T00:00:00Z`) / 1000;
  if (!Number.isFinite(startTime)) throw new Error("Invalid MAQSAM_BACKFILL_FROM");
  try {
    const saved = JSON.parse(await readFile(config.checkpointPath, "utf8"));
    if (saved.version === 2 && saved.from === config.backfillFrom && Number.isFinite(saved.nextTime)) return saved.nextTime;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return startTime;
}

async function saveCheckpoint(nextTime) {
  await mkdir(path.dirname(config.checkpointPath), { recursive: true });
  const temporary = `${config.checkpointPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 2, from: config.backfillFrom, nextTime, updatedAt: new Date().toISOString() }));
  await rename(temporary, config.checkpointPath);
}

async function main() {
  required(config.ingestSecret, "MAQSAM_INGEST_SECRET is missing.");
  authHeader();
  console.log("Maqsam sync worker started; agents=Marita,Daniel; historical import enabled");
  let nextTime = await readCheckpoint();
  let lastRecentSync = 0;
  while (true) {
    let failed = false;
    const now = Math.floor(Date.now() / 1000);
    try {
      if (Date.now() - lastRecentSync >= config.intervalMs) {
        await syncOnce(now - config.lookbackSeconds, now);
        lastRecentSync = Date.now();
      }
      // One bounded day at a time. Advance only after every call was upserted.
      const historicalEnd = now - config.lookbackSeconds;
      if (nextTime < historicalEnd) {
        const endTime = Math.min(nextTime + 86400, historicalEnd);
        await syncOnce(nextTime, endTime);
        await saveCheckpoint(endTime);
        nextTime = endTime;
        console.log(`Maqsam historical import through ${new Date(nextTime * 1000).toISOString()}`);
      }
    } catch (error) {
      failed = true;
      console.error(`Maqsam sync failed: ${error.message}`);
    }
    const importing = nextTime < now - config.lookbackSeconds;
    await new Promise((resolve) => setTimeout(resolve, failed ? 60_000 : importing ? 1_000 : config.intervalMs));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
