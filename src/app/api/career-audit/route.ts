import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMPAIGN = "career-ats-master-audit-2026-08-19-v1";
const DATA_DIR = "/app/data";
const STATE_PATH = path.join(DATA_DIR, `${CAMPAIGN}-state.json`);
const RESULTS_PATH = path.join(DATA_DIR, `${CAMPAIGN}-results.jsonl`);
const CSV_PATH = path.join(DATA_DIR, `${CAMPAIGN}.csv`);
const ENGINE_URL = process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/intelligence-detect";
const ENGINE_TIMEOUT_MS = Math.max(30_000, Number(process.env.CAREER_ENGINE_TIMEOUT_MS || 180_000));
const CONCURRENCY = 6;

const PROPERTIES = [
  "name",
  "domain",
  "company_website",
  "career_page_url",
  "career_portal_type",
  "detected_ats",
  "ats_status",
  "ats_confidence",
  "ats_evidence_url",
  "ats_evidence_reason",
] as const;

type AuditStatus = "idle" | "running" | "completed" | "error";

interface AuditState {
  campaign: string;
  status: AuditStatus;
  total: number;
  completed: number;
  remaining: number;
  updatedVerified: number;
  unchangedVerified: number;
  manualReview: number;
  unresolved: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string;
  lastCompanyId: string;
  lastCompanyName: string;
  error: string;
  csvReady: boolean;
}

interface EngineResult {
  career_status?: string;
  career_url?: string;
  career_confidence_score?: number;
  career_evidence_reason?: string;
  career_evidence_url?: string;
  ats_status?: string;
  detected_ats?: string;
  ats_confidence?: string;
  ats_evidence_url?: string;
  ats_evidence_reason?: string;
  detection_method?: string;
  pages_checked?: number;
  static_pages_checked?: number;
  browser_pages_checked?: number;
  playwright_used?: boolean;
  detection_error?: string;
}

interface AuditRow {
  hs_object_id: string;
  name: string;
  domain: string;
  career_page_url: string;
  detected_ats: string;
  ats_status: string;
  ats_confidence: string;
  ats_evidence_url: string;
  ats_evidence_reason: string;
  audit_decision: string;
  audit_review_required: string;
  audit_previous_career_page_url: string;
  audit_previous_detected_ats: string;
  audit_engine_career_url: string;
  audit_engine_detected_ats: string;
  audit_engine_ats_confidence: string;
  audit_career_confidence_score: string;
  audit_detection_method: string;
  audit_pages_checked: string;
  audit_playwright_used: string;
  audit_checked_at: string;
}

let activeAudit: Promise<void> | null = null;
let appendQueue: Promise<void> = Promise.resolve();

function value(record: HubSpotRecord, property: string) {
  return String(record.properties[property] || "").trim();
}

function normalizeDomain(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "";
  try {
    return new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return input.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

function hostnameFromUrl(raw: string) {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function normalizeAts(raw: string) {
  const input = String(raw || "").trim();
  const lower = input.toLowerCase();
  if (!input) return "";
  if (lower === "hyrdd" || lower.includes("kabi hyrdd") || lower.includes("hyrdd by kabi")) return "KABi";
  if (lower === "oracle recruiting" || lower === "oracle recruiting cloud" || lower === "oracle hcm" || lower === "oracle hcm cloud") return "Oracle HCM Cloud";
  if (lower === "taleo") return "Oracle Taleo";
  if (lower === "adrenalin max") return "Adrenalin";
  return input;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function blankState(): AuditState {
  return {
    campaign: CAMPAIGN,
    status: "idle",
    total: 0,
    completed: 0,
    remaining: 0,
    updatedVerified: 0,
    unchangedVerified: 0,
    manualReview: 0,
    unresolved: 0,
    startedAt: "",
    updatedAt: new Date().toISOString(),
    completedAt: "",
    lastCompanyId: "",
    lastCompanyName: "",
    error: "",
    csvReady: false,
  };
}

async function readState(): Promise<AuditState> {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, "utf8")) as AuditState;
    return parsed?.campaign === CAMPAIGN ? parsed : blankState();
  } catch {
    return blankState();
  }
}

async function saveState(state: AuditState) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const temp = `${STATE_PATH}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, STATE_PATH);
}

async function loadExistingRows() {
  const rows = new Map<string, AuditRow>();
  try {
    const content = await fs.readFile(RESULTS_PATH, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as AuditRow;
        if (row.hs_object_id) rows.set(String(row.hs_object_id), row);
      } catch {
        // Ignore a partially written final line after an interrupted process.
      }
    }
  } catch {
    // First run.
  }
  return rows;
}

async function appendRow(row: AuditRow) {
  appendQueue = appendQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(RESULTS_PATH, `${JSON.stringify(row)}\n`, "utf8");
  });
  await appendQueue;
}

function manualOverride(record: HubSpotRecord): AuditRow | null {
  if (String(record.id) !== "80353158358") return null;
  return {
    hs_object_id: String(record.id),
    name: value(record, "name") || "Advanced Electronic Company (AEC)",
    domain: normalizeDomain(value(record, "domain") || value(record, "company_website") || "aecl.com"),
    career_page_url: "https://career.aecl.com/",
    detected_ats: "KABi",
    ats_status: "detected",
    ats_confidence: "high",
    ats_evidence_url: "https://career.aecl.com/en/auth/jobseeker/signup",
    ats_evidence_reason: "Official AEC candidate signup portal explicitly displays KABi branding/copyright.",
    audit_decision: "update_verified_manual_evidence",
    audit_review_required: "false",
    audit_previous_career_page_url: value(record, "career_page_url"),
    audit_previous_detected_ats: value(record, "detected_ats"),
    audit_engine_career_url: "https://career.aecl.com/",
    audit_engine_detected_ats: "KABi",
    audit_engine_ats_confidence: "high",
    audit_career_confidence_score: "100",
    audit_detection_method: "manual_first_party_evidence",
    audit_pages_checked: "1",
    audit_playwright_used: "false",
    audit_checked_at: new Date().toISOString(),
  };
}

async function auditOne(record: HubSpotRecord): Promise<AuditRow> {
  const overridden = manualOverride(record);
  if (overridden) return overridden;

  const id = String(record.id);
  const name = value(record, "name") || "Unnamed company";
  const existingCareer = value(record, "career_page_url");
  const existingAts = normalizeAts(value(record, "detected_ats"));
  const existingAtsStatus = value(record, "ats_status");
  const existingConfidence = value(record, "ats_confidence");
  const existingEvidence = value(record, "ats_evidence_url");
  const existingReason = value(record, "ats_evidence_reason");
  let domain = normalizeDomain(value(record, "domain") || value(record, "company_website"));
  let website = value(record, "company_website");
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (!domain && existingCareer) domain = hostnameFromUrl(existingCareer);
  if (!website && domain) website = `https://${domain}`;
  if (!website && existingCareer) website = existingCareer;

  let engine: EngineResult = {};
  let engineError = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  const lowQualityExisting = !existingAts || existingConfidence.toLowerCase() !== "high" || /custom|unknown|not detected|hyrdd/i.test(existingAts);

  try {
    if (!domain && !website) throw new Error("No usable domain, website, or Career Page URL for crawler input.");
    const response = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: name,
        company_domain: domain,
        company_website: website,
        known_career_url: existingCareer || undefined,
        detect_ats: true,
        career_only: false,
        stop_on_career: false,
        require_job_detail: false,
        force_browser: lowQualityExisting,
        force_refresh: true,
        max_static_pages: 36,
        max_browser_steps: 12,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; result?: EngineResult; error?: string };
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Career engine HTTP ${response.status}`);
    engine = payload.result || {};
  } catch (error) {
    engineError = error instanceof Error ? error.message : "Career engine request failed";
  } finally {
    clearTimeout(timer);
  }

  const engineCareer = String(engine.career_url || "").trim();
  const engineAts = normalizeAts(String(engine.detected_ats || "").trim());
  const engineAtsConfidence = String(engine.ats_confidence || "").toLowerCase();
  const careerScore = Math.max(0, Math.min(100, Number(engine.career_confidence_score || 0)));
  const careerTrusted = engine.career_status === "found_verified" && Boolean(engineCareer) && careerScore >= 90;
  const atsTrusted = engine.ats_status === "detected" && Boolean(engineAts) && engineAtsConfidence === "high";

  const finalCareer = careerTrusted ? engineCareer : existingCareer;
  const finalAts = atsTrusted ? engineAts : existingAts;
  const finalStatus = finalAts ? "detected" : String(engine.ats_status || existingAtsStatus || "not_detected");
  const finalConfidence = atsTrusted ? "high" : existingConfidence || String(engine.ats_confidence || "");
  const finalEvidence = atsTrusted ? String(engine.ats_evidence_url || engine.career_evidence_url || engineCareer || "") : existingEvidence;
  const finalReason = atsTrusted
    ? String(engine.ats_evidence_reason || engine.career_evidence_reason || "Verified by Career + ATS crawler.")
    : existingReason || engineError || String(engine.detection_error || engine.career_evidence_reason || "Crawler could not produce a stronger verified replacement.");

  const changed = finalCareer !== existingCareer || finalAts !== existingAts;
  const mediumConflict = Boolean(engineAts) && !atsTrusted && existingAts && engineAts.toLowerCase() !== existingAts.toLowerCase();
  let decision = "keep_existing_unresolved";
  let reviewRequired = "true";
  if ((atsTrusted || careerTrusted) && changed) {
    decision = "update_verified";
    reviewRequired = "false";
  } else if ((atsTrusted || careerTrusted) && !changed) {
    decision = "verified_unchanged";
    reviewRequired = "false";
  } else if (mediumConflict) {
    decision = "manual_review_conflict";
  }

  return {
    hs_object_id: id,
    name,
    domain,
    career_page_url: finalCareer,
    detected_ats: finalAts,
    ats_status: finalStatus,
    ats_confidence: finalConfidence,
    ats_evidence_url: finalEvidence,
    ats_evidence_reason: finalReason.slice(0, 1000),
    audit_decision: decision,
    audit_review_required: reviewRequired,
    audit_previous_career_page_url: existingCareer,
    audit_previous_detected_ats: value(record, "detected_ats"),
    audit_engine_career_url: engineCareer,
    audit_engine_detected_ats: engineAts,
    audit_engine_ats_confidence: String(engine.ats_confidence || ""),
    audit_career_confidence_score: String(careerScore),
    audit_detection_method: String(engine.detection_method || (engineError ? "engine_error" : "")),
    audit_pages_checked: String(engine.pages_checked || 0),
    audit_playwright_used: String(Boolean(engine.playwright_used)),
    audit_checked_at: new Date().toISOString(),
  };
}

async function writeCsv(rows: AuditRow[]) {
  const columns: Array<keyof AuditRow> = [
    "hs_object_id", "name", "domain", "career_page_url", "detected_ats", "ats_status", "ats_confidence",
    "ats_evidence_url", "ats_evidence_reason", "audit_decision", "audit_review_required",
    "audit_previous_career_page_url", "audit_previous_detected_ats", "audit_engine_career_url",
    "audit_engine_detected_ats", "audit_engine_ats_confidence", "audit_career_confidence_score",
    "audit_detection_method", "audit_pages_checked", "audit_playwright_used", "audit_checked_at",
  ];
  const sorted = [...rows].sort((a, b) => Number(a.hs_object_id) - Number(b.hs_object_id));
  const csv = [columns.join(","), ...sorted.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\n");
  await fs.writeFile(CSV_PATH, `\uFEFF${csv}\n`, "utf8");
}

function recalculateState(state: AuditState, rows: Map<string, AuditRow>, total: number) {
  state.total = total;
  state.completed = rows.size;
  state.remaining = Math.max(0, total - rows.size);
  state.updatedVerified = [...rows.values()].filter((row) => row.audit_decision.startsWith("update_verified")).length;
  state.unchangedVerified = [...rows.values()].filter((row) => row.audit_decision === "verified_unchanged").length;
  state.manualReview = [...rows.values()].filter((row) => row.audit_decision === "manual_review_conflict").length;
  state.unresolved = [...rows.values()].filter((row) => row.audit_decision === "keep_existing_unresolved").length;
}

async function runAudit() {
  const state = await readState();
  try {
    const all = await searchAll("companies", PROPERTIES, [], ["hs_object_id"]);
    const targets = all.filter((record) => Boolean(value(record, "career_page_url") || value(record, "detected_ats")));
    const rows = await loadExistingRows();
    const completedIds = new Set(rows.keys());
    const pending = targets.filter((record) => !completedIds.has(String(record.id)));

    state.status = "running";
    state.error = "";
    state.startedAt ||= new Date().toISOString();
    recalculateState(state, rows, targets.length);
    await saveState(state);

    let cursor = 0;
    let sinceCheckpoint = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= pending.length) return;
        const record = pending[index];
        const row = await auditOne(record);
        await appendRow(row);
        rows.set(row.hs_object_id, row);
        state.lastCompanyId = row.hs_object_id;
        state.lastCompanyName = row.name;
        sinceCheckpoint += 1;
        if (sinceCheckpoint >= 10) {
          sinceCheckpoint = 0;
          recalculateState(state, rows, targets.length);
          await saveState(state);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, () => worker()));
    await appendQueue;
    recalculateState(state, rows, targets.length);
    await writeCsv([...rows.values()]);
    state.status = "completed";
    state.completedAt = new Date().toISOString();
    state.csvReady = true;
    await saveState(state);
  } catch (error) {
    state.status = "error";
    state.error = error instanceof Error ? error.message : "Career audit failed";
    await saveState(state);
  } finally {
    activeAudit = null;
  }
}

export async function GET(request: NextRequest) {
  const download = request.nextUrl.searchParams.get("download") === "1";
  const state = await readState();
  if (!download) {
    return NextResponse.json({ ...state, activeInProcess: Boolean(activeAudit), downloadReady: state.csvReady }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!state.csvReady) return NextResponse.json({ error: "Master CSV is not ready yet", state }, { status: 409 });
  try {
    const csv = await fs.readFile(CSV_PATH, "utf8");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Talentera_Career_ATS_Master_Audit_2026-08-19.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "CSV state is complete but the output file is missing" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action === "status") return GET(request);
  const current = await readState();
  if (current.status === "completed" && current.csvReady) {
    return NextResponse.json({ message: "Audit already completed", state: current }, { status: 200 });
  }
  if (activeAudit) {
    return NextResponse.json({ message: "Audit already running", state: current }, { status: 202 });
  }
  activeAudit = runAudit();
  return NextResponse.json({ message: "Full Career + ATS audit started/resumed", campaign: CAMPAIGN }, { status: 202 });
}
