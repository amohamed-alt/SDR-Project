"use client";

import Link from "next/link";
import { SalesNavCollectorControls } from "./SalesNavCollectorControls";
import { publicPersonProfile, shouldCheckCapturedProfile } from "@/lib/salesnav-profile-sync";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, CalendarClock, CheckCircle2, CircleAlert, Download, ExternalLink, History,
  LoaderCircle, Phone, RefreshCw, Search, Send, ShieldCheck, Sparkles, UserRoundCheck, UsersRound,
} from "lucide-react";
import styles from "./SalesNavPipeline.module.css";

type Lead = { name: string; title: string; company: string; location: string; connectionDegree: string; salesLeadUrl: string; linkedinUrl: string };
type SavedLeadState = { prospect?: Prospect; revealStatus?: string; revealError?: string; lastPushAt?: string; pushCompleted?: boolean; taskId?: string; resumeContactId?: string; pushRetryable?: boolean };
type Run = { leadStates?: (SavedLeadState | null)[]; clientVersion?: string; id: string; startedAt: string; updatedAt: string; completedAt: string; complete: boolean; stopReason: string; sourceUrl: string; searchFingerprint: string; pagesRead: number; total: number; leads: Lead[] };
type RunSummary = Omit<Run, "leads">;
type ContactCheck = { inHubSpot: boolean; id: string; matchedBy: string; properties?: Record<string, unknown> };
type CompanyCheck = {
  inHubSpot: boolean; id: string; matchedBy: string; name: string; domain: string; accountType: string; accountStatus: string;
  detectedAts: string; careerPageUrl: string; protected: boolean; protectedReason: string; gateReason?: string;
  connectedCallCount: number; meetingCount: number; latestConnectedCallAt: string; connectedCallAgeDays?: number | null;
  engagementChecked: boolean; engagementError: string;
};
type Precheck = { contact: ContactCheck; company: CompanyCheck; checkedAt?: string };
type Prospect = Record<string, unknown> & {
  fullName?: string; title?: string; company?: string; location?: string; linkedinUrl?: string;
  phone?: string; phones?: string[]; email?: string; emails?: string[]; detectedAts?: string; careerPageUrl?: string; companyDomain?: string;
};
type Stage = "awaiting-profile" | "needs-profile" | "pending" | "checking" | "blocked" | "needs-reveal" | "revealing" | "ready" | "no-phone" | "pushed" | "error";
type Row = { key: string; lead: Lead; stage: Stage; precheck?: Precheck; prospect?: Prospect; error?: string; message?: string; cachedReveal?: boolean; revealStatus?: string; resumeContactId?: string; pushRetryable?: boolean };
type Owner = { id: string; name: string };
type View = "ready" | "needs-reveal" | "blocked" | "pushed" | "review" | "all";

function keyFor(lead: Lead) { return lead.salesLeadUrl || lead.linkedinUrl || `${lead.name}:${lead.company}`; }
function unique(values: unknown[]) {
  const seen = new Set<string>();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    const key = value.toLowerCase(); if (!value || seen.has(key)) return false; seen.add(key); return true;
  });
}
function prospectPhones(row: Row) { return unique([row.prospect?.phone, ...(Array.isArray(row.prospect?.phones) ? row.prospect?.phones || [] : [])]); }
function readyPhone(row: Row) { return prospectPhones(row)[0] || ""; }
function existingEmail(row: Row) { return String(row.precheck?.contact.properties?.email || "").trim(); }
function isRetention(row: Row) { return String(row.precheck?.company.accountType || "").trim().toLowerCase() === "retention"; }
function recoverablePush(row: Row) {
  const company = row.precheck?.company;
  return Boolean(row.pushRetryable && row.resumeContactId && row.precheck?.contact.id === row.resumeContactId && company
    && company.gateReason === "Existing person blocked" && typeof company.accountType === "string"
    && company.accountType.trim().toLowerCase() !== "retention" && company.meetingCount === 0 && company.connectedCallCount === 0
    && (!company.inHubSpot || company.engagementChecked === true));
}
function isExistingPerson(row: Row) { return Boolean(row.precheck?.contact.inHubSpot && !recoverablePush(row)); }
function blockedCompany(row: Row) { return Boolean(row.precheck?.company.protected && !recoverablePush(row)); }
function savedRow(lead: Lead, complete: boolean, state?: SavedLeadState | null, previous?: Row): Row {
  const prospect = state?.prospect || previous?.prospect;
  const revealStatus = state?.revealStatus || previous?.revealStatus;
  const row: Row = { ...(previous || { key: keyFor(lead), stage: "pending" as Stage }), lead, prospect, revealStatus, resumeContactId: state?.resumeContactId || previous?.resumeContactId, pushRetryable: state?.pushRetryable ?? previous?.pushRetryable, cachedReveal: Boolean(state?.prospect) || previous?.cachedReveal };
  if ((state?.lastPushAt || state?.pushCompleted) && state.taskId) return { ...row, stage: "pushed", message: `Saved HubSpot task ${state.taskId}`, error: undefined };
  if (previous?.stage === "pushed") return row;
  if (revealStatus === "pending" || revealStatus === "uncertain") return { ...row, stage: "error", error: state?.revealError || "Reveal result is pending or uncertain. Reload the saved result before another paid request." };
  if (previous && previous.revealStatus === revealStatus && JSON.stringify(previous.prospect) === JSON.stringify(prospect)) return row;
  return { ...row, stage: !complete && !publicPersonProfile(lead.linkedinUrl) ? "awaiting-profile" : "pending", error: undefined };
}
function checkedStage(row: Row, checked: Precheck, complete: boolean): Stage {
  const checkedRow = { ...row, precheck: checked };
  if (blockedCompany(checkedRow) || isExistingPerson(checkedRow)) return "blocked";
  if (row.revealStatus === "pending" || row.revealStatus === "uncertain") return "error";
  if (!publicPersonProfile(row.lead.linkedinUrl)) return complete ? "needs-profile" : "awaiting-profile";
  if (readyPhone(row)) return "ready";
  if (row.revealStatus === "no-result" || row.revealStatus === "completed" || row.stage === "no-phone") return "no-phone";
  return "needs-reveal";
}

function tomorrowLocal() {
  const date = new Date(); date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function runLabel(run: RunSummary) {
  const date = new Date(run.startedAt || run.updatedAt);
  const stamp = Number.isNaN(date.getTime()) ? "Saved run" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  return `${stamp} · ${run.pagesRead}p · ${run.total} leads${run.complete ? "" : " · running"}`;
}
async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text(); if (!text.trim()) return {} as T;
  try { return JSON.parse(text) as T; } catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 160)}`); }
}
async function fetchPrecheckLead(lead: Lead) {
  const response = await fetch("/api/prospecting/salesnav/precheck-v2", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: lead.name, company: lead.company, linkedinUrl: lead.linkedinUrl, email: "", emails: [], phone: "", phones: [] }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await readJson<Precheck & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "HubSpot precheck failed.");
  return payload;
}

// Manual and streaming checks can overlap. Share only the active request;
// completed or failed checks are never cached here, so Retry always revalidates.
const inFlightPrechecks = new Map<string, Promise<Precheck>>();
function precheckLead(lead: Lead) {
  const key = JSON.stringify([lead.name, lead.company, lead.linkedinUrl]);
  const existing = inFlightPrechecks.get(key);
  if (existing) return existing;
  const request = fetchPrecheckLead(lead).finally(() => inFlightPrechecks.delete(key));
  inFlightPrechecks.set(key, request);
  return request;
}

export function SalesNavPipelineV2() {
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [ownerId, setOwnerId] = useState("31644369");
  const [dueDate, setDueDate] = useState(tomorrowLocal());
  const [dueTime, setDueTime] = useState("09:00");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>("all");
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [message, setMessage] = useState("");
  const [newRunNotice, setNewRunNotice] = useState("");
  const [newRunId, setNewRunId] = useState("");
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [repairKey, setRepairKey] = useState("");
  const [repairUrl, setRepairUrl] = useState("");
  const [repairing, setRepairing] = useState(false);
  const loadGeneration = useRef(0);
  const activeRunId = useRef("");

  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = processing || revealing || pushing; }, [processing, revealing, pushing]);

  const loadRun = useCallback(async (id = "") => {
    if (busyRef.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/prospecting/salesnav/full-run${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
      if (generation !== loadGeneration.current) return;
      if (response.status === 401) { setUnauthorized(true); setRun(null); setRows([]); return; }
      const payload = await readJson<{ run?: Run | null; history?: RunSummary[]; error?: string }>(response);
      if (generation !== loadGeneration.current) return;
      if (!response.ok) throw new Error(payload.error || "Could not load Sales Nav runs.");
      activeRunId.current = payload.run?.id || "";
      setNewRunNotice(""); setNewRunId("");
      setUnauthorized(false); setRun(payload.run || null); setHistory(payload.history || []);
      setRows((payload.run?.leads || []).map((lead, index) => savedRow(lead, Boolean(payload.run?.complete), payload.run?.leadStates?.[index])));
      setSelected(new Set()); setView("all");
      setMessage(payload.run ? `${payload.run.total} leads loaded. HubSpot Check will keep Ready strictly net-new people.` : "No Sales Navigator full-search run found yet.");
    } catch (requestError) { if (generation === loadGeneration.current) setError(requestError instanceof Error ? requestError.message : "Could not load Sales Nav runs."); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void loadRun();
    fetch("/api/prospecting/salesnav/task-options", { cache: "no-store" }).then(async (response) => {
      const payload = await readJson<{ owners?: Owner[]; defaultOwner?: Owner | null; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Could not load task owners.");
      setOwners(payload.owners || []); if (payload.defaultOwner?.id) setOwnerId(payload.defaultOwner.id);
    }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Could not load task owners."));
  }, [loadRun]);

  useEffect(() => {
    const onNewRun = (event: Event) => {
      const id = (event as CustomEvent<{ runId?: string }>).detail?.runId || "";
      if (processing || revealing || pushing || loading) { setNewRunId(id); setNewRunNotice("A new capture is saved. Open it when this batch finishes."); return; }
      void loadRun(id);
    };
    window.addEventListener("salesnav:new-run", onNewRun);
    return () => window.removeEventListener("salesnav:new-run", onNewRun);
  }, [processing, revealing, pushing, loading, loadRun]);

  useEffect(() => {
    if (!run?.id || processing || revealing || pushing) return;
    let active = true, syncing = false, syncAgain = false;
    const sync = async () => {
      if (!active) return;
      if (syncing) { syncAgain = true; return; }
      syncing = true;
      try {
        const response = await fetch(`/api/prospecting/salesnav/full-run?id=${encodeURIComponent(run.id)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await readJson<{ run?: Run }>(response);
        if (!active || payload.run?.id !== run.id) return;
        const previousRows = new Map(rowsRef.current.map(row => [row.key, row]));
        const latestRun = payload.run;
        const nextRows = latestRun.leads.map((lead, index) => savedRow(lead, latestRun.complete, latestRun.leadStates?.[index], previousRows.get(keyFor(lead))));
        const changed = nextRows.filter(row => shouldCheckCapturedProfile(row.lead, row) || shouldCheckCapturedProfile(row.lead, previousRows.get(row.key)));
        setRun(latestRun);
        setRows(nextRows);
        const pending = [...changed];
        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
          while (active && pending.length) {
            const source = pending.shift()!;
            const lead = source.lead;
            try {
              const checked = await precheckLead(lead);
              if (!active) return;
              setRows(current => current.map(row => row.key === keyFor(lead) ? { ...row, lead, precheck: checked, stage: checkedStage(row, checked, latestRun.complete), error: undefined } : row));
            } catch (requestError) {
              if (active) setRows(current => current.map(row => row.key === keyFor(lead) ? { ...row, lead, stage: "error", error: requestError instanceof Error ? requestError.message : "Profile check failed." } : row));
            }
          }
        }));
      } catch { /* Keep the saved queue visible; the next status change retries. */ }
      finally {
        syncing = false;
        if (active && syncAgain) { syncAgain = false; void sync(); }
      }
    };
    const onSync = () => { void sync(); };
    window.addEventListener("salesnav:profiles-synced", onSync);
    void sync();
    return () => { active = false; window.removeEventListener("salesnav:profiles-synced", onSync); };
  }, [run?.id, processing, revealing, pushing]);

  async function repairProfile(row: Row) {
    if (!run || repairing || !publicPersonProfile(repairUrl)) return;
    setRepairing(true); setError("");
    try {
      const response = await fetch("/api/prospecting/salesnav/full-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.id, salesLeadUrl: row.lead.salesLeadUrl, linkedinUrl: repairUrl }) });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Could not save profile URL.");
      setRepairKey(""); setRepairUrl("");
      window.dispatchEvent(new CustomEvent("salesnav:profiles-synced"));
      setMessage("Public profile URL saved. Checking eligibility without contact credits.");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not save profile URL."); }
    finally { setRepairing(false); }
  }

  async function runPrecheck() {
    if (!rows.length || processing || revealing || pushing) return;
    const pending = rows.filter(row => row.stage !== "pushed");
    if (!pending.length) return;
    const total = pending.length;
    const operationRunId = activeRunId.current;
    setProcessing(true); setError(""); setMessage(""); setSelected(new Set()); setView("all");
    setProgress({ done: 0, total, label: "HubSpot check" });
    let checkedCount = 0, failedCount = 0;
    const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift(); if (!source) return;
        // HubSpot supports name + company checks without a public URL. Missing
        // URLs gate paid reveal, not the free CRM check or its progress counter.
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "checking", precheck: undefined, error: undefined } : row));
        try {
          const checked = await precheckLead(source.lead);
          if (activeRunId.current !== operationRunId) return;
          const stage = checkedStage(source, checked, Boolean(run?.complete));
          checkedCount += 1;
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, precheck: checked, stage, error: stage === "error" ? source.error || "Review the uncertain reveal before another paid request." : undefined } : row));
        } catch (requestError) {
          if (activeRunId.current !== operationRunId) return;
          failedCount += 1;
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "HubSpot check failed." } : row));
        } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
      }
    });
    await Promise.all(workers); setSelected(new Set()); setProcessing(false);
    setMessage(`HubSpot: ${checkedCount}/${total} checked · ${failedCount} failed. Missing public URLs are listed below and update as Scrape progresses.`);
  }

  async function revealSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && publicPersonProfile(row.lead.linkedinUrl) && row.stage === "needs-reveal" && !isExistingPerson(row) && !blockedCompany(row));
    if (!queue.length || loading || processing || revealing || pushing) return;
    if (!window.confirm(`Reveal ${queue.length} eligible net-new person${queue.length === 1 ? "" : "s"}? First-time successful reveals can consume SignalHire Contact Credits; cached reveals cost 0.`)) return;
    const operationRunId = activeRunId.current;
    setRevealing(true); setError(""); setProgress({ done: 0, total: queue.length, label: "SignalHire reveal" });
    const pending = [...queue]; const autoReady = new Set<string>(); let failed = 0;
    const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift(); if (!source) return;
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "revealing", error: undefined } : row));
        let failureStatus = "";
        try {
          const response = await fetch("/api/prospecting/salesnav/reveal-fast", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run?.id || "", lead: source.lead }),
          });
          const payload = await readJson<{ prospect?: Prospect | null; postRevealCheck?: Precheck; cached?: boolean; message?: string; error?: string; revealStatus?: string }>(response);
          if (!response.ok) { failureStatus = payload.revealStatus || ""; throw new Error(payload.error || "SignalHire reveal failed."); }
          if (activeRunId.current !== operationRunId) return;
          const checked = payload.postRevealCheck || source.precheck;
          const nextRow: Row = { ...source, precheck: checked, prospect: payload.prospect || undefined, revealStatus: payload.prospect ? "completed" : "no-result", cachedReveal: Boolean(payload.cached), message: payload.message };
          const blocked = blockedCompany(nextRow) || isExistingPerson(nextRow);
          const stage: Stage = blocked ? "blocked" : readyPhone(nextRow) ? "ready" : "no-phone";
          if (stage === "ready") autoReady.add(source.key);
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, ...nextRow, stage } : row));
        } catch (requestError) {
          if (activeRunId.current !== operationRunId) return;
          failed += 1;
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: failureStatus === "retryable" ? "needs-reveal" : failureStatus === "no-result" ? "no-phone" : "error", revealStatus: failureStatus || row.revealStatus, error: requestError instanceof Error ? requestError.message : "Reveal failed." } : row));
        } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
      }
    });
    await Promise.all(workers); setSelected(autoReady); setRevealing(false); setView(failed ? "all" : "ready");
    setMessage(`${autoReady.size} new phone-ready people auto-selected · ${failed} failed. SignalHire reveals now run up to 4 in parallel and no longer wait for ATS/career research.`);
  }

  function taskDueIso() { const date = new Date(`${dueDate}T${dueTime}:00`); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); }

  async function pushSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && row.stage === "ready" && readyPhone(row) && !isExistingPerson(row) && !blockedCompany(row));
    if (!queue.length || loading || processing || revealing || pushing) return;
    if (!ownerId) { setError("Choose the task owner first."); return; }
    const dueAt = taskDueIso(); if (!dueAt) { setError("Choose a valid task date and time."); return; }
    const ownerName = owners.find((owner) => owner.id === ownerId)?.name || "selected owner";
    if (!window.confirm(`Push ${queue.length} NEW phone-ready person${queue.length === 1 ? "" : "s"} and create CALL tasks for ${ownerName} on ${dueDate} at ${dueTime}?`)) return;
    const operationRunId = activeRunId.current;
    setPushing(true); setError(""); setProgress({ done: 0, total: queue.length, label: "Push + Tasks" });
    const pending = [...queue]; let pushedCount = 0, failedCount = 0;
    // CRM writes are serialized; one task failure cannot race another owner reservation.
    const workers = Array.from({ length: Math.min(1, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift(); if (!source || !source.prospect) return;
        let retryable = false, resumeContactId = "";
        try {
          const response = await fetch("/api/prospecting/salesnav/push-ready-v2", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run?.id || "", taskOwnerId: ownerId, taskDueAt: dueAt, lead: source.lead, prospect: source.prospect }),
          });
          const payload = await readJson<{ duplicate?: boolean; taskId?: string; ownerName?: string; error?: string; retryable?: boolean; contactId?: string }>(response);
          if (!response.ok) { retryable = payload.retryable === true; resumeContactId = String(payload.contactId || ""); throw new Error(payload.error || "Push + Task failed."); }
          if (activeRunId.current !== operationRunId) return;
          pushedCount += 1;
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "pushed", error: undefined, pushRetryable: false, resumeContactId: "", message: payload.duplicate ? `Existing task kept · ${payload.taskId || "found"}` : `Task ${payload.taskId || "created"} → ${payload.ownerName || ownerName}` } : row));
        } catch (requestError) {
          if (activeRunId.current !== operationRunId) return;
          failedCount += 1;
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: retryable ? "ready" : "error", pushRetryable: retryable, resumeContactId: resumeContactId || row.resumeContactId, error: requestError instanceof Error ? requestError.message : "Push failed.", message: retryable ? "Push did not finish. Select this saved person and Push again to resume safely." : undefined } : row));
        } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
      }
    });
    await Promise.all(workers); setSelected(new Set()); setPushing(false); setView(failedCount ? "all" : "pushed"); setMessage(`Push: ${pushedCount}/${queue.length} completed · ${failedCount} failed. Successful HubSpot tasks are saved; review the visible failures before retrying.`);
  }

  function exportRunCsv() {
    if (!run || loading || !rows.length) return;
    try {
      const mapped = rows.map((row) => ({
        "Run ID": run.id,
        "Captured at": run.startedAt,
        "Full name": row.prospect?.fullName || row.lead.name,
        "Job title": row.prospect?.title || row.lead.title,
        Company: row.prospect?.company || row.precheck?.company.name || row.lead.company,
        Location: row.prospect?.location || row.lead.location,
        "Connection degree": row.lead.connectionDegree,
        "LinkedIn URL": row.prospect?.linkedinUrl || row.lead.linkedinUrl,
        "Sales Navigator URL": row.lead.salesLeadUrl,
        "Company domain": row.prospect?.companyDomain || row.precheck?.company.domain,
        Phone: readyPhone(row),
        "All phones": prospectPhones(row).join("; "),
        Email: row.prospect?.email || existingEmail(row),
        "All emails": unique([row.prospect?.email, ...(Array.isArray(row.prospect?.emails) ? row.prospect.emails : []), existingEmail(row)]).join("; "),
        Status: row.stage,
        "HubSpot contact ID": row.precheck?.contact.id,
        "HubSpot company ID": row.precheck?.company.id,
        "Account type": row.precheck?.company.accountType,
        "Account status": row.precheck?.company.accountStatus,
        "HubSpot gate": row.precheck ? row.precheck.contact.inHubSpot ? "Existing person" : row.precheck.company.protected ? "Blocked" : "Eligible" : "Not checked",
        "Gate reason": row.precheck?.company.protectedReason || row.precheck?.company.gateReason,
        ATS: row.prospect?.detectedAts || row.precheck?.company.detectedAts,
        "Career page URL": row.prospect?.careerPageUrl || row.precheck?.company.careerPageUrl,
        Notes: row.error || row.message,
      }));
      const headers = Object.keys(mapped[0]) as (keyof typeof mapped[number])[];
      const cell = (value: unknown) => {
        let text = value == null ? "" : String(value);
        // Preserve phone prefixes/leading zeroes and keep spreadsheet cells as text.
        if (/^[\s]*[=+@-]/.test(text) || /^0\d+$/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
      };
      const csv = "\uFEFF" + [headers.map(cell).join(","), ...mapped.map((row) => headers.map((header) => cell(row[header])).join(","))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `salesnav-${run.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${rows.length}-leads.csv`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setError("");
      setMessage(`Exported all ${rows.length} leads from this run. Includes available contact data and HubSpot checks; view filters do not limit the export.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export this run.");
    }
  }

  const counts = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((row) => row.stage === "ready" && readyPhone(row) && !isExistingPerson(row)).length,
    reveal: rows.filter((row) => row.stage === "needs-reveal" && !isExistingPerson(row)).length,
    blocked: rows.filter((row) => row.stage === "blocked").length,
    retention: rows.filter((row) => row.stage === "blocked" && isRetention(row)).length,
    existingPeople: rows.filter((row) => isExistingPerson(row)).length,
    callsEligible: rows.filter((row) => !isExistingPerson(row) && !blockedCompany(row) && (row.precheck?.company.connectedCallCount || 0) > 0 && (row.precheck?.company.meetingCount || 0) === 0).length,
    pushed: rows.filter((row) => row.stage === "pushed").length,
    review: rows.filter((row) => row.stage === "awaiting-profile" || row.stage === "needs-profile" || row.stage === "error" || row.stage === "no-phone").length,
    profiles: rows.filter((row) => !publicPersonProfile(row.lead.linkedinUrl) && row.stage !== "pushed").length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "ready" && (row.stage !== "ready" || isExistingPerson(row))) return false;
      if (view === "needs-reveal" && (row.stage !== "needs-reveal" || isExistingPerson(row))) return false;
      if (view === "blocked" && row.stage !== "blocked") return false;
      if (view === "pushed" && row.stage !== "pushed") return false;
      if (view === "review" && row.stage !== "awaiting-profile" && row.stage !== "needs-profile" && row.stage !== "error" && row.stage !== "no-phone") return false;
      if (!term) return true;
      return [row.lead.name, row.lead.title, row.lead.company, row.lead.location, row.precheck?.company.gateReason, row.precheck?.company.accountType, row.prospect?.detectedAts, row.prospect?.phone].some((value) => String(value || "").toLowerCase().includes(term));
    }).sort((a, b) => Number(Boolean(readyPhone(b))) - Number(Boolean(readyPhone(a))));
  }, [query, rows, view]);

  const selectable = visible.filter((row) => (row.stage === "ready" && readyPhone(row)) || row.stage === "needs-reveal");
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.key));
  const selectedReveal = rows.filter((row) => selected.has(row.key) && row.stage === "needs-reveal" && !isExistingPerson(row)).length;
  const selectedPush = rows.filter((row) => selected.has(row.key) && row.stage === "ready" && readyPhone(row) && !isExistingPerson(row)).length;
  const ownerName = owners.find((owner) => owner.id === ownerId)?.name || "—";
  function toggleVisible() { setSelected((current) => { const next = new Set(current); for (const row of selectable) { if (allSelected) next.delete(row.key); else next.add(row.key); } return next; }); }

  if (unauthorized) return <main className={styles.page}><div className={styles.shell}><section className={styles.warning}><CircleAlert size={18}/><div><strong>Sales Nav setup is locked.</strong><span>Unlock Companion setup on this browser, then return to the queue.</span><Link href="/salesnav-prospecting">Open Companion setup</Link></div></section></div></main>;

  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><div><Link href="/" className={styles.back}><ArrowLeft size={15}/>SDR Command Center</Link><span className={styles.eyebrow}><ShieldCheck size={14}/>SALES NAV → HUBSPOT → SIGNALHIRE</span><h1>Persistent Prospecting Queue</h1><p>Ready to Push = NEW person only + eligible company + phone. Existing companies are allowed unless Retention or they already have a meeting.</p></div><div className={styles.headerStats}><span><History size={13}/>{history.length} saved runs</span><span><Phone size={13}/>{counts.ready} new phone-ready</span></div></header>
    {newRunNotice && <div className={styles.notice}>{newRunNotice}<button disabled={loading || processing || revealing || pushing} onClick={() => void loadRun(newRunId)}>Open new capture</button></div>}
    {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}{message && <div className={styles.notice}><CheckCircle2 size={15}/>{message}</div>}
    {(loading || processing || revealing || pushing) && <div className={styles.progress}><LoaderCircle className={styles.spin} size={15}/>{loading ? "Loading…" : `${progress.label} ${progress.done}/${progress.total}`}</div>}

    <SalesNavCollectorControls runId={run?.id || ""} missing={rows.filter(row => !publicPersonProfile(row.lead.linkedinUrl)).length} captureLocked={processing || revealing || pushing} readLocked={revealing || pushing}/>
      <section className={styles.runBar}><div className={styles.runSelect}><label>Search history</label><select aria-label="Search history" value={run?.id || ""} onChange={(event) => void loadRun(event.target.value)} disabled={loading || processing || revealing || pushing}>{history.map((item) => <option key={item.id} value={item.id}>{runLabel(item)}</option>)}</select><small>{run ? `${run.pagesRead} pages · ${run.total} unique leads · ${run.complete ? run.stopReason || "completed" : "capture can resume"} · Companion ${run.clientVersion || "version unknown"}` : "No run loaded"}</small></div><div className={styles.runActions}><button onClick={() => void loadRun(run?.id || "")} disabled={loading || processing || revealing || pushing}><RefreshCw size={14}/>Reload</button><button onClick={exportRunCsv} disabled={loading || !run || !rows.length} title="Download all captured leads in this run, including available enrichment and checks"><Download size={14}/>Export CSV ({rows.length})</button><button className={styles.primary} onClick={() => void runPrecheck()} disabled={!run?.complete || !rows.length || loading || processing || revealing || pushing}><ShieldCheck size={14}/>HubSpot Check</button>{run?.sourceUrl && <a href={run.sourceUrl} target="_blank" rel="noreferrer">Open Sales Nav <ExternalLink size={11}/></a>}</div></section>

    <section className={styles.metrics}><article><UsersRound size={16}/><span>Saved</span><strong>{counts.total}</strong></article><article><Phone size={16}/><span>Ready · NEW + phone</span><strong>{counts.ready}</strong></article><article><Sparkles size={16}/><span>Needs reveal</span><strong>{counts.reveal}</strong></article><article><ShieldCheck size={16}/><span>Blocked</span><strong>{counts.blocked}</strong></article><article><UserRoundCheck size={16}/><span>Retention</span><strong>{counts.retention}</strong></article><article><UserRoundCheck size={16}/><span>Existing people</span><strong>{counts.existingPeople}</strong></article><article><CheckCircle2 size={16}/><span>Calls · no meeting</span><strong>{counts.callsEligible}</strong></article><article><Send size={16}/><span>Pushed</span><strong>{counts.pushed}</strong></article></section>

    <section className={styles.dispatch}><div><label>Task owner</label><select disabled={pushing} value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></div><div><label>Due date</label><input disabled={pushing} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)}/></div><div><label>Time</label><input disabled={pushing} type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)}/></div><div className={styles.dispatchSummary}><CalendarClock size={15}/><span>CALL tasks → <b>{ownerName}</b> → {dueDate} {dueTime}</span></div><button className={styles.revealButton} disabled={!selectedReveal || loading || processing || revealing || pushing} onClick={() => void revealSelected()}><Sparkles size={14}/>Reveal selected ({selectedReveal})</button><button className={styles.pushButton} disabled={!selectedPush || loading || processing || revealing || pushing} onClick={() => void pushSelected()}><Send size={14}/>Push NEW Ready + Tasks ({selectedPush})</button></section>

    <section className={styles.toolbar}><div className={styles.tabs}><button data-active={view === "ready"} onClick={() => setView("ready")}>Ready NEW <b>{counts.ready}</b></button><button data-active={view === "needs-reveal"} onClick={() => setView("needs-reveal")}>Need reveal <b>{counts.reveal}</b></button><button data-active={view === "blocked"} onClick={() => setView("blocked")}>Blocked <b>{counts.blocked}</b></button><button data-active={view === "pushed"} onClick={() => setView("pushed")}>Pushed <b>{counts.pushed}</b></button><button data-active={view === "review"} onClick={() => setView("review")}>Review <b>{counts.review}</b></button><button data-active={view === "all"} onClick={() => setView("all")}>All <b>{counts.total}</b></button></div><label className={styles.search}><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, company, status, ATS…"/></label></section>
    <section className={styles.selection}><button onClick={toggleVisible}>{allSelected ? "Unselect visible" : "Select visible"}</button><span><b>{selected.size}</b> selected · {selectedReveal} reveal · {selectedPush} NEW push-ready</span></section>

    <section className={styles.tablePanel}><div className={styles.tableHeader}><div><h2>Review queue</h2><p>Existing person = block · Retention = block · Meeting = block · Connected call without meeting = eligible · Ready = NEW person with phone.</p></div><span>{visible.length} visible</span></div>{counts.profiles > 0 && <section className={styles.warning} role="status"><CircleAlert size={18}/><div><strong>Missing public profile URLs: {counts.profiles}</strong><span>The extension is reading these automatically. HubSpot Check unlocks when the capture is ready. Use Read / retry only if a profile fails. No contact credits are used.</span></div></section>}
    <div className={styles.tableWrap}><table><thead><tr><th/><th>Person</th><th>Company</th><th>HubSpot gate</th><th>Contact</th><th>ATS / Career</th><th>Status</th></tr></thead><tbody>
      {visible.map((row) => { const company = row.precheck?.company; const phone = readyPhone(row); const canSelect = (row.stage === "ready" && Boolean(phone)) || row.stage === "needs-reveal"; const ats = String(row.prospect?.detectedAts || company?.detectedAts || ""); const career = String(row.prospect?.careerPageUrl || company?.careerPageUrl || ""); return <tr key={row.key} data-blocked={row.stage === "blocked"}><td><input type="checkbox" disabled={!canSelect} checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}/></td><td><strong>{String(row.prospect?.fullName || row.lead.name)}</strong><span>{String(row.prospect?.title || row.lead.title || "—")}</span><small>{String(row.prospect?.location || row.lead.location || "—")}</small><div className={styles.links}>{row.lead.salesLeadUrl && <a href={row.lead.salesLeadUrl} target="_blank" rel="noreferrer">Sales Nav <ExternalLink size={10}/></a>}{(row.prospect?.linkedinUrl || row.lead.linkedinUrl) && <a href={String(row.prospect?.linkedinUrl || row.lead.linkedinUrl)} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={10}/></a>}</div>{!publicPersonProfile(row.lead.linkedinUrl) && row.lead.salesLeadUrl && <div className={styles.profileRepair}>{repairKey === row.key ? <><label>Public LinkedIn URL for {row.lead.name}<input type="url" aria-label={`Public LinkedIn URL for ${row.lead.name}`} placeholder="https://www.linkedin.com/in/…" value={repairUrl} onChange={event => setRepairUrl(event.target.value)}/></label><button onClick={() => void repairProfile(row)} disabled={repairing || !publicPersonProfile(repairUrl)}>Save profile URL</button><button onClick={() => setRepairKey("")} disabled={repairing}>Cancel</button></> : <button onClick={() => { setRepairKey(row.key); setRepairUrl(""); }} disabled={processing || revealing || pushing}>Add profile URL</button>}</div>}</td><td><strong>{String(row.prospect?.company || company?.name || row.lead.company || "—")}</strong><span>{String(row.prospect?.companyDomain || company?.domain || "")}</span><small>{company?.inHubSpot ? `${company.accountType || "Existing"}${company.accountStatus ? ` · ${company.accountStatus}` : ""}` : row.precheck ? "Net-new company" : "Not checked"}</small></td><td>{row.stage === "checking" ? <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>Checking</span> : blockedCompany(row) || isExistingPerson(row) ? <><span className={styles.blockedBadge}><ShieldCheck size={11}/>Blocked</span><small>{company?.protectedReason || "Existing HubSpot person"}</small></> : row.precheck ? <><span className={styles.goodBadge}><CheckCircle2 size={11}/>Eligible</span><small>{company?.gateReason || "No blocker found"}</small></> : <span>Pending</span>}</td><td>{phone ? <strong className={styles.phone}><Phone size={11}/>{phone}</strong> : <span>No phone yet</span>}<small>{String(row.prospect?.email || existingEmail(row) || "") || (isExistingPerson(row) ? "Existing HubSpot contact" : "")}</small></td><td><strong>{ats || "—"}</strong>{career && <a href={career} target="_blank" rel="noreferrer">Career <ExternalLink size={10}/></a>}<small>{row.prospect && !ats && !career ? "Deferred for faster reveal" : ""}</small></td><td><strong>{row.stage === "awaiting-profile" ? "Awaiting profile read" : row.stage === "needs-profile" ? "Needs profile URL" : row.stage === "ready" ? row.pushRetryable && row.resumeContactId ? "Resume Push" : "Ready NEW" : row.stage === "needs-reveal" ? "Needs reveal" : row.stage === "revealing" ? "Revealing" : row.stage === "no-phone" ? "No phone" : row.stage === "pushed" ? "Pushed" : row.stage === "blocked" ? "Blocked" : row.stage === "error" ? "Error" : row.stage}</strong><small>{row.stage === "awaiting-profile" ? "Use Read / retry missing URLs above; see collector progress and per-person errors here." : row.stage === "needs-profile" ? "Use Read / retry missing URLs above before reveal. No contact credits used." : row.error || row.message || (row.cachedReveal ? "Cached reveal · 0 credit" : "")}</small></td></tr>; })}
      {!visible.length && <tr><td colSpan={7}><div className={styles.empty}>{loading ? "Loading…" : "No rows in this view."}</div></td></tr>}
    </tbody></table></div></section>
  </div></main>;
}

