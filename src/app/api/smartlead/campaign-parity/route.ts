import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { VISIBLE_SEQUENCE_LANES, type OutreachLane } from "@/lib/smartlead-visible-sequences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
const LANES = Object.keys(VISIBLE_SEQUENCE_LANES) as OutreachLane[];

type JsonObject = Record<string, unknown>;

type CampaignAudit = {
  id: number;
  name: string;
  status: string;
  settings: {
    plainText: boolean;
    forcePlainText: boolean;
    trackingOff: boolean;
    stopOnReply: boolean;
    pauseDomainOnReply: boolean;
    respectMailboxLimit: boolean;
    bounceAutopauseThreshold: number;
    domainRateLimit: boolean;
    unsubscribeTag: boolean;
    followUpPercentage: number;
    espMatching: boolean;
    timezone: string;
    days: number[];
    startHour: string;
    endHour: string;
    minimumGapMinutes: number;
    maxNewLeadsPerDay: number;
  };
  sequence: {
    count: number;
    delays: number[];
    threadedFollowUps: boolean;
    firstSubjectPresent: boolean;
  };
};

function clean(value: unknown, max = 4_000) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function list(value: unknown, keys: string[] = []) { if (Array.isArray(value)) return value; const item = object(value); for (const key of keys) if (Array.isArray(item[key])) return item[key] as unknown[]; return [] as unknown[]; }
function numberValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function boolValue(value: unknown) { return value === true || value === 1 || String(value).toLowerCase() === "true"; }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function apiKey() { return clean(process.env.SMARTLEAD_API_KEY, 8_000); }
function authorized(request: NextRequest) { const supplied = clean(request.headers.get("authorization"), 8_000).replace(/^Bearer\s+/i, ""); const expected = apiKey(); return Boolean(expected && supplied && safeEqual(supplied, expected)); }

async function smartleadRequest<T>(endpoint: string): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("SMARTLEAD_API_KEY is not configured.");
  const query = new URLSearchParams({ api_key: key });
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${SMARTLEAD_API}${endpoint}?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.json() as T;
      const body = (await response.text()).slice(0, 500);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
        continue;
      }
      throw new Error(`Smartlead ${endpoint} audit failed (${response.status}): ${body}`);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Smartlead parity request failed.");
}

function normalizeCampaign(row: JsonObject, sequencePayload: unknown): CampaignAudit {
  const schedule = object(row.scheduler_cron_value || row.schedule || row.scheduler);
  const track = list(row.track_settings).map((value) => clean(value).toUpperCase());
  const sequences = list(sequencePayload, ["sequences", "data"]);
  const normalizedSequences = sequences.map((value) => {
    const item = object(value);
    const delay = object(item.seq_delay_details || item.delay_details);
    return {
      subject: clean(item.subject),
      delay: numberValue(delay.delay_in_days ?? item.delay_in_days),
    };
  });
  return {
    id: numberValue(row.id),
    name: clean(row.name),
    status: clean(row.status),
    settings: {
      plainText: boolValue(row.send_as_plain_text),
      forcePlainText: boolValue(row.force_plain_text),
      trackingOff: track.includes("DONT_TRACK_EMAIL_OPEN") && track.includes("DONT_TRACK_LINK_CLICK"),
      stopOnReply: clean(row.stop_lead_settings).toUpperCase() === "REPLY_TO_AN_EMAIL",
      pauseDomainOnReply: boolValue(row.auto_pause_domain_leads_on_reply),
      respectMailboxLimit: !boolValue(row.ignore_ss_mailbox_sending_limit),
      bounceAutopauseThreshold: numberValue(row.bounce_autopause_threshold),
      domainRateLimit: boolValue(row.domain_level_rate_limit),
      unsubscribeTag: boolValue(row.add_unsubscribe_tag),
      followUpPercentage: numberValue(row.follow_up_percentage),
      espMatching: boolValue(row.enable_ai_esp_matching),
      timezone: clean(schedule.tz || schedule.timezone),
      days: list(schedule.days || schedule.days_of_the_week).map(numberValue),
      startHour: clean(schedule.startHour || schedule.start_hour),
      endHour: clean(schedule.endHour || schedule.end_hour),
      minimumGapMinutes: numberValue(row.min_time_btwn_emails ?? row.min_time_btw_emails ?? schedule.min_time_btw_emails),
      maxNewLeadsPerDay: numberValue(row.max_new_leads_per_day ?? row.max_leads_per_day ?? schedule.max_new_leads_per_day ?? schedule.max_leads_per_day),
    },
    sequence: {
      count: normalizedSequences.length,
      delays: normalizedSequences.map((item) => item.delay),
      threadedFollowUps: normalizedSequences.length === 3 && normalizedSequences[1]?.subject === "" && normalizedSequences[2]?.subject === "",
      firstSubjectPresent: Boolean(normalizedSequences[0]?.subject),
    },
  };
}

function expectedSettings(lane: OutreachLane, settings: CampaignAudit["settings"]) {
  const dailyCap = lane.startsWith("talentera") ? 15 : 10;
  return settings.plainText === true
    && settings.forcePlainText === true
    && settings.trackingOff === true
    && settings.stopOnReply === true
    && settings.pauseDomainOnReply === true
    && settings.respectMailboxLimit === true
    && settings.bounceAutopauseThreshold === 2
    && settings.domainRateLimit === true
    && settings.unsubscribeTag === true
    && settings.followUpPercentage === 100
    && settings.espMatching === true
    && settings.timezone === "Asia/Riyadh"
    && JSON.stringify(settings.days) === JSON.stringify([0, 1, 2, 3, 4])
    && settings.startHour === "09:30"
    && settings.endHour === "16:30"
    && settings.minimumGapMinutes >= 15
    && settings.maxNewLeadsPerDay === dailyCap;
}

function expectedSequence(sequence: CampaignAudit["sequence"]) {
  return sequence.count === 3
    && JSON.stringify(sequence.delays) === JSON.stringify([0, 4, 6])
    && sequence.threadedFollowUps
    && sequence.firstSubjectPresent;
}

async function audit() {
  const campaignPayload = await smartleadRequest<unknown>("/campaigns/");
  const rows = list(campaignPayload, ["campaigns", "data"]).map(object);
  const byName = new Map(rows.map((row) => [clean(row.name), row]));
  const audits = {} as Record<OutreachLane, CampaignAudit>;
  const issues: string[] = [];

  for (const lane of LANES) {
    const definition = VISIBLE_SEQUENCE_LANES[lane];
    const row = byName.get(definition.campaignName);
    if (!row) {
      issues.push(`${definition.label}: campaign missing`);
      continue;
    }
    const id = numberValue(row.id);
    const sequencePayload = await smartleadRequest<unknown>(`/campaigns/${id}/sequences`);
    const normalized = normalizeCampaign(row, sequencePayload);
    audits[lane] = normalized;
    if (!expectedSettings(lane, normalized.settings)) issues.push(`${definition.label}: non-copy settings are not canonical`);
    if (!expectedSequence(normalized.sequence)) issues.push(`${definition.label}: sequence structure is not canonical/threaded`);
  }

  const campaignCount = Object.keys(audits).length;
  return {
    ok: campaignCount === LANES.length && issues.length === 0,
    blocked: campaignCount !== LANES.length || issues.length > 0,
    policy: "All four campaigns must share one canonical non-copy configuration; only product, language copy and brand-safe sender pools may differ.",
    canonical: {
      touchTiming: [0, 4, 6],
      followUpsThreaded: true,
      plainText: true,
      tracking: "off",
      stopOnReply: true,
      espMatching: true,
      timezone: "Asia/Riyadh",
      days: [0, 1, 2, 3, 4],
      sendWindow: "09:30-16:30",
      minimumGapMinutes: 15,
      laneDailyCaps: { talentera_ar: 15, talentera_en: 15, evalufy_ar: 10, evalufy_en: 10 },
      globalDailyCap: 50,
    },
    campaigns: audits,
    issues,
  };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized campaign parity request." }, { status: 401 });
  try {
    const result = await audit();
    return NextResponse.json(result, { status: result.ok ? 200 : 409, headers: { "Cache-Control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("Smartlead campaign parity audit failed", { error });
    return NextResponse.json({ error: "Smartlead campaign parity audit failed", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
