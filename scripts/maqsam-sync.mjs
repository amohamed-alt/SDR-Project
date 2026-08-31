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

function isTargetAgentCall(call) {
  const agents = Array.isArray(call.agents) ? call.agents : [];
  return agents.some((agent) => String(agent?.email ?? "").trim().toLowerCase() === config.targetAgentEmail);
}

function isReadyCall(call) {
  const type = String(call.type ?? "").toLowerCase();
  const state = String(call.state ?? "").toLowerCase();
  const duration = Number(call.duration ?? 0);
  return type !== "internal" && ["completed", "serviced"].includes(state) && duration > 0;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
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

async function fetchRecentCalls() {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - config.lookbackSeconds;
  const output = new Map();
  const authorization = authHeader();

  for (let page = 1; page <= config.pageCount; page += 1) {
    const url = new URL(MAQSAM_API_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("end_time", String(endTime));

    const payload = await fetchJson(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
    });

    const calls = Array.isArray(payload.message) ? payload.message : [];
    for (const call of calls) {
      const key = String(call?.id ?? call?.referenceId ?? "").trim();
      if (key && !output.has(key)) output.set(key, call);
    }
  }

  return [...output.values()];
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

async function syncOnce() {
  const calls = await fetchRecentCalls();
  let ready = 0;
  let upserted = 0;
  let skipped = 0;

  for (const call of calls) {
    if (!isTargetAgentCall(call) || !isReadyCall(call)) {
      skipped += 1;
      continue;
    }

    const { text: summary, language: summaryLanguage } = extractSummary(call.summary);
    if (!summary) {
      skipped += 1;
      continue;
    }

    const callKey = String(call.id ?? call.referenceId ?? "").trim();
    const timestampSeconds = Number(call.timestamp);
    const timestampMs = Number.isFinite(timestampSeconds) && timestampSeconds > 0 ? timestampSeconds * 1000 : Date.now();
    const agents = Array.isArray(call.agents) ? call.agents : [];
    const targetAgent = agents.find((agent) => String(agent?.email ?? "").trim().toLowerCase() === config.targetAgentEmail) ?? agents[0] ?? {};
    const phoneRaw = getPhone(call);
    const phone = phoneParts(phoneRaw);

    if (!callKey || phone.full.length < 7) {
      skipped += 1;
      continue;
    }

    ready += 1;
    const match = await resolveHubspotContact(phone).catch((error) => {
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
      summary,
      summaryLanguage,
      transcription: String(call.transcription ?? ""),
      segments: Array.isArray(call.segments) ? call.segments : [],
      sentiment: String(call.sentiment ?? ""),
      tags: [...(Array.isArray(call.tags) ? call.tags : []), ...(Array.isArray(call.autoTags) ? call.autoTags : [])],
      ...match,
    });
    upserted += 1;
  }

  console.log(`Maqsam sync: fetched=${calls.length}; ready=${ready}; upserted=${upserted}; skipped=${skipped}`);
}

async function main() {
  required(config.ingestSecret, "MAQSAM_INGEST_SECRET is missing.");
  authHeader();
  console.log(`Maqsam sync worker started; target=${config.targetAgentEmail}; every=${Math.round(config.intervalMs / 1000)}s; lookback=${config.lookbackSeconds}s`);

  while (true) {
    const started = Date.now();
    await syncOnce().catch((error) => {
      console.error(`Maqsam sync failed: ${error.stack || error.message}`);
    });

    const elapsed = Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, Math.max(5_000, config.intervalMs - elapsed)));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
