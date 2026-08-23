import { timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  analyzeRecipientNames,
  bootstrapSmartleadV2,
  getSmartleadV2,
  launchPreparedSmartleadV2,
  prepareSmartleadV2,
  setSmartleadV2Status,
  syncSmartleadV2Senders,
} from "@/lib/smartlead-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const STATE_PATH = process.env.SMARTLEAD_AUTOPILOT_STATE_PATH || "/app/data/smartlead-v2-autopilot.json";
const PREPARED_PATH = process.env.SMARTLEAD_V2_PREPARED_PATH || "/app/data/smartlead-v2-prepared.json";
const BUSINESS_DAYS = new Set(["Sun", "Mon", "Tue", "Wed", "Thu"]);
const BOUNCE_GUARD_MIN_SENT = 50;
const BOUNCE_GUARD_RATE = 0.03;
const LOCK_TTL_MS = 20 * 60 * 1000;

type AutopilotStatus = "never" | "running" | "success" | "noop" | "blocked" | "failed";

type AutopilotState = {
  version: 1;
  status: AutopilotStatus;
  riyadhDate: string;
  startedAt: string;
  finishedAt: string;
  lastSuccessfulDate: string;
  prepared: number;
  queued: number;
  talentera: number;
  evalufy: number;
  message: string;
  warnings: string[];
};

const EMPTY_STATE: AutopilotState = {
  version: 1,
  status: "never",
  riyadhDate: "",
  startedAt: "",
  finishedAt: "",
  lastSuccessfulDate: "",
  prepared: 0,
  queued: 0,
  talentera: 0,
  evalufy: 0,
  message: "Autopilot has not run yet.",
  warnings: [],
};

function clean(value: unknown, max = 4_000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: NextRequest) {
  const expected = clean(process.env.SMARTLEAD_API_KEY, 8_000);
  const supplied = clean(request.headers.get("authorization"), 8_000).replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function riyadhClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    hour: Number(value("hour") || 0),
    minute: Number(value("minute") || 0),
  };
}

async function readState(): Promise<AutopilotState> {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, "utf8")) as Partial<AutopilotState>;
    return { ...EMPTY_STATE, ...parsed, version: 1 };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(state: AutopilotState) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, STATE_PATH);
}

async function normalizeEvalufyPreparedCopy() {
  try {
    const raw = await fs.readFile(PREPARED_PATH, "utf8");
    const normalized = raw.replace(/Evalify/g, "Evalufy");
    if (normalized !== raw) await fs.writeFile(PREPARED_PATH, normalized, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Prepare may legitimately produce no file when there is no eligible capacity.
  }
}

function reputationWarnings(payload: Awaited<ReturnType<typeof getSmartleadV2>>) {
  const warnings: string[] = [];
  for (const product of ["talentera", "evalify"] as const) {
    const analytics = payload.analytics[product];
    if (analytics.sent >= BOUNCE_GUARD_MIN_SENT && analytics.bounceRate >= BOUNCE_GUARD_RATE) {
      const label = product === "talentera" ? "Talentera" : "Evalufy";
      warnings.push(`${label} bounce rate is ${(analytics.bounceRate * 100).toFixed(1)}% after ${analytics.sent} sends; automatic sending is locked at the 3% guardrail.`);
    }
  }
  return warnings;
}

function statusPayload(state: AutopilotState) {
  return {
    enabled: process.env.SMARTLEAD_AUTOPILOT_ENABLED !== "false",
    timezone: "Asia/Riyadh",
    businessDays: "Sunday-Thursday",
    queueAttemptsRiyadh: ["08:45", "09:05", "09:25"],
    smartleadSendWindowRiyadh: `${clean(process.env.SMARTLEAD_START_HOUR) || "09:30"}-${clean(process.env.SMARTLEAD_END_HOUR) || "16:30"}`,
    starterDailyNewLeadTarget: Number(process.env.SMARTLEAD_DAILY_NEW_LEADS || 75),
    bounceGuard: { minSent: BOUNCE_GUARD_MIN_SENT, maxRate: BOUNCE_GUARD_RATE },
    state,
  };
}

export async function GET() {
  return NextResponse.json(statusPayload(await readState()), {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized autopilot request." }, { status: 401 });
  if (process.env.SMARTLEAD_AUTOPILOT_ENABLED === "false") {
    return NextResponse.json({ ok: true, skipped: true, reason: "Autopilot is disabled." });
  }

  const clock = riyadhClock();
  const previous = await readState();

  if (!BUSINESS_DAYS.has(clock.weekday)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "KSA weekend; no new cold outreach is queued.", ...statusPayload(previous) });
  }

  if (previous.lastSuccessfulDate === clock.date && ["success", "noop"].includes(previous.status)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Today's batch was already processed successfully.", ...statusPayload(previous) });
  }

  if (previous.status === "running" && previous.startedAt && Date.now() - new Date(previous.startedAt).getTime() < LOCK_TTL_MS) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Another autopilot run is still in progress.", ...statusPayload(previous) });
  }

  const startedAt = new Date().toISOString();
  await writeState({
    ...EMPTY_STATE,
    status: "running",
    riyadhDate: clock.date,
    startedAt,
    lastSuccessfulDate: previous.lastSuccessfulDate,
    message: "Refreshing safety, campaigns, sender pools, recipient intelligence and today's queue.",
  });

  try {
    await bootstrapSmartleadV2();
    await syncSmartleadV2Senders();

    let snapshot = await getSmartleadV2(true);
    const warnings = [...snapshot.safety.warnings, ...reputationWarnings(snapshot)];
    if (!snapshot.safety.healthy || warnings.length) {
      const state: AutopilotState = {
        ...EMPTY_STATE,
        status: "blocked",
        riyadhDate: clock.date,
        startedAt,
        finishedAt: new Date().toISOString(),
        lastSuccessfulDate: previous.lastSuccessfulDate,
        message: "Autopilot failed closed. No lead was queued; a later morning attempt may retry automatically.",
        warnings,
      };
      await writeState(state);
      return NextResponse.json({ ok: true, blocked: true, ...statusPayload(state) });
    }

    if (!snapshot.configuration.openRouterConfigured) {
      const state: AutopilotState = {
        ...EMPTY_STATE,
        status: "blocked",
        riyadhDate: clock.date,
        startedAt,
        finishedAt: new Date().toISOString(),
        lastSuccessfulDate: previous.lastSuccessfulDate,
        message: "OpenRouter is not configured, so automated recipient-language QA is locked.",
        warnings: ["OPENROUTER_API_KEY is unavailable in the production runtime."],
      };
      await writeState(state);
      return NextResponse.json({ ok: true, blocked: true, ...statusPayload(state) });
    }

    if (snapshot.capacity.liveNewLeadsPerDay < 1 || snapshot.summary.ready < 1) {
      const state: AutopilotState = {
        ...EMPTY_STATE,
        status: "noop",
        riyadhDate: clock.date,
        startedAt,
        finishedAt: new Date().toISOString(),
        lastSuccessfulDate: clock.date,
        message: snapshot.summary.ready < 1 ? "No eligible Marita contacts remain today." : "No safe live sender capacity is available today.",
      };
      await writeState(state);
      return NextResponse.json({ ok: true, ...statusPayload(state) });
    }

    const aiLimit = Math.min(150, Math.max(50, snapshot.capacity.liveNewLeadsPerDay * 2));
    await analyzeRecipientNames(aiLimit);
    snapshot = await getSmartleadV2(true);

    const afterAiWarnings = [...snapshot.safety.warnings, ...reputationWarnings(snapshot)];
    if (!snapshot.safety.healthy || afterAiWarnings.length) {
      const state: AutopilotState = {
        ...EMPTY_STATE,
        status: "blocked",
        riyadhDate: clock.date,
        startedAt,
        finishedAt: new Date().toISOString(),
        lastSuccessfulDate: previous.lastSuccessfulDate,
        message: "Fresh safety changed during recipient QA; no batch was queued.",
        warnings: afterAiWarnings,
      };
      await writeState(state);
      return NextResponse.json({ ok: true, blocked: true, ...statusPayload(state) });
    }

    const prepared = await prepareSmartleadV2(snapshot.capacity.liveNewLeadsPerDay);
    await normalizeEvalufyPreparedCopy();
    const launched = await launchPreparedSmartleadV2();

    if (launched.queued > 0) await setSmartleadV2Status("all", "START");

    const state: AutopilotState = {
      ...EMPTY_STATE,
      status: launched.queued > 0 ? "success" : "noop",
      riyadhDate: clock.date,
      startedAt,
      finishedAt: new Date().toISOString(),
      lastSuccessfulDate: clock.date,
      prepared: prepared.prepared,
      queued: launched.queued,
      talentera: launched.talentera,
      evalufy: launched.evalify,
      message: launched.queued > 0
        ? `Queued ${launched.queued} new contacts safely. Smartlead owns the Day 0 / Day 3 / Day 7 follow-ups.`
        : "No new contacts survived the final fresh safety and dedupe check.",
      warnings: [],
    };
    await writeState(state);
    return NextResponse.json({ ok: true, ...statusPayload(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Smartlead autopilot error";
    const noEligible = /No eligible leads|No live sender capacity|Every prepared lead failed/i.test(message);
    const state: AutopilotState = {
      ...EMPTY_STATE,
      status: noEligible ? "noop" : "failed",
      riyadhDate: clock.date,
      startedAt,
      finishedAt: new Date().toISOString(),
      lastSuccessfulDate: noEligible ? clock.date : previous.lastSuccessfulDate,
      message: noEligible ? message : "Autopilot failed before queueing. Later scheduled attempts can retry safely.",
      warnings: noEligible ? [] : [message],
    };
    await writeState(state);
    return NextResponse.json({ ok: noEligible, ...statusPayload(state) }, { status: noEligible ? 200 : 500 });
  }
}
