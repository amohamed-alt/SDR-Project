"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarClock, CheckCircle2, CircleAlert, ExternalLink, History,
  LoaderCircle, Phone, RefreshCw, Search, Send, ShieldCheck, Sparkles, UserRoundCheck, UsersRound,
} from "lucide-react";
import styles from "./SalesNavPipeline.module.css";

type Lead = { name: string; title: string; company: string; location: string; connectionDegree: string; salesLeadUrl: string; linkedinUrl: string };
type Run = { id: string; startedAt: string; updatedAt: string; completedAt: string; complete: boolean; stopReason: string; sourceUrl: string; searchFingerprint: string; pagesRead: number; total: number; leads: Lead[] };
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
type Stage = "pending" | "checking" | "blocked" | "needs-reveal" | "revealing" | "ready" | "no-phone" | "pushed" | "error";
type Row = { key: string; lead: Lead; stage: Stage; precheck?: Precheck; prospect?: Prospect; error?: string; message?: string; cachedReveal?: boolean };
type Owner = { id: string; name: string };
type View = "ready" | "needs-reveal" | "blocked" | "pushed" | "review" | "all";

function keyFor(lead: Lead) { return lead.linkedinUrl || lead.salesLeadUrl || `${lead.name}:${lead.company}`; }
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
function isExistingPerson(row: Row) { return Boolean(row.precheck?.contact.inHubSpot); }
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
async function precheckLead(lead: Lead) {
  const response = await fetch("/api/prospecting/salesnav/precheck-v2", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: lead.name, company: lead.company, linkedinUrl: lead.linkedinUrl, email: "", emails: [], phone: "", phones: [] }),
  });
  const payload = await readJson<Precheck & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "HubSpot precheck failed.");
  return payload;
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
  const [view, setView] = useState<View>("ready");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);

  async function loadRun(id = "") {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/prospecting/salesnav/full-run${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
      if (response.status === 401) { setUnauthorized(true); setRun(null); setRows([]); return; }
      const payload = await readJson<{ run?: Run | null; history?: RunSummary[]; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Could not load Sales Nav runs.");
      setUnauthorized(false); setRun(payload.run || null); setHistory(payload.history || []);
      setRows((payload.run?.leads || []).map((lead) => ({ key: keyFor(lead), lead, stage: "pending" })));
      setSelected(new Set()); setView("ready");
      setMessage(payload.run ? `${payload.run.total} leads loaded. HubSpot Check will keep Ready strictly net-new people.` : "No Sales Navigator full-search run found yet.");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not load Sales Nav runs."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void loadRun();
    fetch("/api/prospecting/salesnav/task-options", { cache: "no-store" }).then(async (response) => {
      const payload = await readJson<{ owners?: Owner[]; defaultOwner?: Owner | null; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Could not load task owners.");
      setOwners(payload.owners || []); if (payload.defaultOwner?.id) setOwnerId(payload.defaultOwner.id);
    }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Could not load task owners."));
  }, []);

  async function runPrecheck() {
    if (!rows.length || processing) return;
    setProcessing(true); setError(""); setSelected(new Set()); setProgress({ done: 0, total: rows.length, label: "HubSpot check" });
    setRows((current) => current.map((row) => ({ ...row, stage: "pending", precheck: undefined, prospect: undefined, error: undefined, message: undefined })));
    const pending = [...rows]; const autoReady = new Set<string>();
    const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift(); if (!source) return;
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "checking" } : row));
        try {
          const checked = await precheckLead(source.lead);
          const blocked = checked.company.protected || checked.contact.inHubSpot;
          const stage: Stage = blocked ? "blocked" : "needs-reveal";
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, precheck: checked, stage } : row));
          if (stage === "ready") autoReady.add(source.key);
        } catch (requestError) {
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "HubSpot check failed." } : row));
        } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
      }
    });
    await Promise.all(workers); setSelected(autoReady); setProcessing(false); setView("needs-reveal");
    setMessage("HubSpot gate complete: existing people, Retention and any company with a meeting are blocked. Connected calls without a meeting remain eligible, even if recent.");
  }

  async function revealSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && row.stage === "needs-reveal" && !isExistingPerson(row) && !row.precheck?.company.protected);
    if (!queue.length || revealing) return;
    if (!window.confirm(`Reveal ${queue.length} eligible net-new person${queue.length === 1 ? "" : "s"}? First-time successful reveals can consume SignalHire Contact Credits; cached reveals cost 0.`)) return;
    setRevealing(true); setError(""); setProgress({ done: 0, total: queue.length, label: "SignalHire reveal" });
    const pending = [...queue]; const autoReady = new Set<string>();
    const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift(); if (!source) return;
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "revealing", error: undefined } : row));
        try {
          const response = await fetch("/api/prospecting/salesnav/reveal-fast", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run?.id || "", lead: source.lead }),
          });
          const payload = await readJson<{ prospect?: Prospect | null; postRevealCheck?: Precheck; cached?: boolean; message?: string; error?: string }>(response);
          if (!response.ok) throw new Error(payload.error || "SignalHire reveal failed.");
          const checked = payload.postRevealCheck || source.precheck;
          const nextRow: Row = { ...source, precheck: checked, prospect: payload.prospect || undefined, cachedReveal: Boolean(payload.cached), message: payload.message };
          const blocked = Boolean(checked?.contact.inHubSpot || checked?.company.protected);
          const stage: Stage = blocked ? "blocked" : readyPhone(nextRow) ? "ready" : "no-phone";
          if (stage === "ready") autoReady.add(source.key);
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, ...nextRow, stage } : row));
        } catch (requestError) {
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "Reveal failed." } : row));
        } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
      }
    });
    await Promise.all(workers); setSelected(autoReady); setRevealing(false); setView("ready");
    setMessage(`${autoReady.size} new phone-ready people auto-selected. SignalHire reveals now run up to 4 in parallel and no longer wait for ATS/career research.`);
  }

  function taskDueIso() { const date = new Date(`${dueDate}T${dueTime}:00`); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); }

  async function pushSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && row.stage === "ready" && readyPhone(row) && !isExistingPerson(row) && !row.precheck?.company.protected);
    if (!queue.length || pushing) return;
    if (!ownerId) { setError("Choose the task owner first."); return; }
    const dueAt = taskDueIso(); if (!dueAt) { setError("Choose a valid task date and time."); return; }
    const ownerName = owners.find((owner) => owner.id === ownerId)?.name || "selected owner";
    if (!window.confirm(`Push ${queue.length} NEW phone-ready person${queue.length === 1 ? "" : "s"} and create CALL tasks for ${ownerName} on ${dueDate} at ${dueTime}?`)) return;
    setPushing(true); setError(""); setProgress({ done: 0, total: queue.length, label: "Push + Tasks" });
    const pending = [...queue];
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift(); if (!source || !source.prospect) return;
        try {
          const response = await fetch("/api/prospecting/salesnav/push-ready-v2", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run?.id || "", taskOwnerId: ownerId, taskDueAt: dueAt, lead: source.lead, prospect: source.prospect }),
          });
          const payload = await readJson<{ duplicate?: boolean; taskId?: string; ownerName?: string; error?: string }>(response);
          if (!response.ok) throw new Error(payload.error || "Push + Task failed.");
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "pushed", message: payload.duplicate ? `Existing task kept · ${payload.taskId || "found"}` : `Task ${payload.taskId || "created"} → ${payload.ownerName || ownerName}` } : row));
        } catch (requestError) {
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "Push failed." } : row));
        } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
      }
    });
    await Promise.all(workers); setSelected(new Set()); setPushing(false); setView("pushed"); setMessage("Push finished. Server rechecked that every pushed person was still net-new immediately before writing to HubSpot.");
  }

  const counts = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((row) => row.stage === "ready" && readyPhone(row) && !isExistingPerson(row)).length,
    reveal: rows.filter((row) => row.stage === "needs-reveal" && !isExistingPerson(row)).length,
    blocked: rows.filter((row) => row.stage === "blocked").length,
    retention: rows.filter((row) => row.stage === "blocked" && isRetention(row)).length,
    existingPeople: rows.filter((row) => isExistingPerson(row)).length,
    callsEligible: rows.filter((row) => !isExistingPerson(row) && !row.precheck?.company.protected && (row.precheck?.company.connectedCallCount || 0) > 0 && (row.precheck?.company.meetingCount || 0) === 0).length,
    pushed: rows.filter((row) => row.stage === "pushed").length,
    review: rows.filter((row) => row.stage === "error" || row.stage === "no-phone").length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "ready" && (row.stage !== "ready" || isExistingPerson(row))) return false;
      if (view === "needs-reveal" && (row.stage !== "needs-reveal" || isExistingPerson(row))) return false;
      if (view === "blocked" && row.stage !== "blocked") return false;
      if (view === "pushed" && row.stage !== "pushed") return false;
      if (view === "review" && row.stage !== "error" && row.stage !== "no-phone") return false;
      if (!term) return true;
      return [row.lead.name, row.lead.title, row.lead.company, row.lead.location, row.precheck?.company.gateReason, row.precheck?.company.accountType, row.prospect?.detectedAts, row.prospect?.phone].some((value) => String(value || "").toLowerCase().includes(term));
    }).sort((a, b) => Number(Boolean(readyPhone(b))) - Number(Boolean(readyPhone(a))));
  }, [query, rows, view]);

  const selectable = visible.filter((row) => (row.stage === "ready" && readyPhone(row)) || row.stage === "needs-reveal");
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.key));
  const selectedReveal = rows.filter((row) => selected.has(row.key) && row.stage === "needs-reveal" && !isExistingPerson(row)).length;
  const selectedPush = rows.filter((row) => selected.has(row.key) && row.stage === "ready" && readyPhone(row) && !isExistingPerson(row)).length;
  const ownerName = owners.find((owner) => owner.id === ownerId)?.name || "—";
  function toggleVisible() { setSelected((current) => { const next = new Set(current); for (const row of selectable) allSelected ? next.delete(row.key) : next.add(row.key); return next; }); }

  if (unauthorized) return <main className={styles.page}><div className={styles.shell}><section className={styles.warning}><CircleAlert size={18}/><div><strong>Sales Nav setup is locked.</strong><span>Unlock Companion setup on this browser, then return to the queue.</span><Link href="/salesnav-prospecting">Open Companion setup</Link></div></section></div></main>;

  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><div><Link href="/" className={styles.back}><ArrowLeft size={15}/>SDR Command Center</Link><span className={styles.eyebrow}><ShieldCheck size={14}/>SALES NAV → HUBSPOT → SIGNALHIRE</span><h1>Persistent Prospecting Queue</h1><p>Ready to Push = NEW person only + eligible company + phone. Existing companies are allowed unless Retention or they already have a meeting.</p></div><div className={styles.headerStats}><span><History size={13}/>{history.length} saved runs</span><span><Phone size={13}/>{counts.ready} new phone-ready</span></div></header>
    {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}{message && <div className={styles.notice}><CheckCircle2 size={15}/>{message}</div>}
    {(loading || processing || revealing || pushing) && <div className={styles.progress}><LoaderCircle className={styles.spin} size={15}/>{loading ? "Loading…" : `${progress.label} ${progress.done}/${progress.total}`}</div>}

    <section className={styles.runBar}><div className={styles.runSelect}><label>Search history</label><select value={run?.id || ""} onChange={(event) => void loadRun(event.target.value)} disabled={loading}>{history.map((item) => <option key={item.id} value={item.id}>{runLabel(item)}</option>)}</select><small>{run ? `${run.pagesRead} pages · ${run.total} unique leads · ${run.complete ? run.stopReason || "completed" : "capture can resume"}` : "No run loaded"}</small></div><div className={styles.runActions}><button onClick={() => void loadRun(run?.id || "")} disabled={loading}><RefreshCw size={14}/>Reload</button><button className={styles.primary} onClick={() => void runPrecheck()} disabled={!rows.length || processing}><ShieldCheck size={14}/>HubSpot Check</button>{run?.sourceUrl && <a href={run.sourceUrl} target="_blank" rel="noreferrer">Open Sales Nav <ExternalLink size={11}/></a>}</div></section>

    <section className={styles.metrics}><article><UsersRound size={16}/><span>Saved</span><strong>{counts.total}</strong></article><article><Phone size={16}/><span>Ready · NEW + phone</span><strong>{counts.ready}</strong></article><article><Sparkles size={16}/><span>Needs reveal</span><strong>{counts.reveal}</strong></article><article><ShieldCheck size={16}/><span>Blocked</span><strong>{counts.blocked}</strong></article><article><UserRoundCheck size={16}/><span>Retention</span><strong>{counts.retention}</strong></article><article><UserRoundCheck size={16}/><span>Existing people</span><strong>{counts.existingPeople}</strong></article><article><CheckCircle2 size={16}/><span>Calls · no meeting</span><strong>{counts.callsEligible}</strong></article><article><Send size={16}/><span>Pushed</span><strong>{counts.pushed}</strong></article></section>

    <section className={styles.dispatch}><div><label>Task owner</label><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></div><div><label>Due date</label><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)}/></div><div><label>Time</label><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)}/></div><div className={styles.dispatchSummary}><CalendarClock size={15}/><span>CALL tasks → <b>{ownerName}</b> → {dueDate} {dueTime}</span></div><button className={styles.revealButton} disabled={!selectedReveal || revealing} onClick={() => void revealSelected()}><Sparkles size={14}/>Reveal selected ({selectedReveal})</button><button className={styles.pushButton} disabled={!selectedPush || pushing} onClick={() => void pushSelected()}><Send size={14}/>Push NEW Ready + Tasks ({selectedPush})</button></section>

    <section className={styles.toolbar}><div className={styles.tabs}><button data-active={view === "ready"} onClick={() => setView("ready")}>Ready NEW <b>{counts.ready}</b></button><button data-active={view === "needs-reveal"} onClick={() => setView("needs-reveal")}>Need reveal <b>{counts.reveal}</b></button><button data-active={view === "blocked"} onClick={() => setView("blocked")}>Blocked <b>{counts.blocked}</b></button><button data-active={view === "pushed"} onClick={() => setView("pushed")}>Pushed <b>{counts.pushed}</b></button><button data-active={view === "review"} onClick={() => setView("review")}>Review <b>{counts.review}</b></button><button data-active={view === "all"} onClick={() => setView("all")}>All <b>{counts.total}</b></button></div><label className={styles.search}><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, company, status, ATS…"/></label></section>
    <section className={styles.selection}><button onClick={toggleVisible}>{allSelected ? "Unselect visible" : "Select visible"}</button><span><b>{selected.size}</b> selected · {selectedReveal} reveal · {selectedPush} NEW push-ready</span></section>

    <section className={styles.tablePanel}><div className={styles.tableHeader}><div><h2>Review queue</h2><p>Existing person = block · Retention = block · Meeting = block · Connected call without meeting = eligible · Ready = NEW person with phone.</p></div><span>{visible.length} visible</span></div><div className={styles.tableWrap}><table><thead><tr><th/><th>Person</th><th>Company</th><th>HubSpot gate</th><th>Contact</th><th>ATS / Career</th><th>Status</th></tr></thead><tbody>
      {visible.map((row) => { const company = row.precheck?.company; const phone = readyPhone(row); const canSelect = (row.stage === "ready" && Boolean(phone)) || row.stage === "needs-reveal"; const ats = String(row.prospect?.detectedAts || company?.detectedAts || ""); const career = String(row.prospect?.careerPageUrl || company?.careerPageUrl || ""); return <tr key={row.key} data-blocked={row.stage === "blocked"}><td><input type="checkbox" disabled={!canSelect} checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; })}/></td><td><strong>{String(row.prospect?.fullName || row.lead.name)}</strong><span>{String(row.prospect?.title || row.lead.title || "—")}</span><small>{String(row.prospect?.location || row.lead.location || "—")}</small><div className={styles.links}>{row.lead.salesLeadUrl && <a href={row.lead.salesLeadUrl} target="_blank" rel="noreferrer">Sales Nav <ExternalLink size={10}/></a>}{row.prospect?.linkedinUrl && <a href={String(row.prospect.linkedinUrl)} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={10}/></a>}</div></td><td><strong>{String(row.prospect?.company || company?.name || row.lead.company || "—")}</strong><span>{String(row.prospect?.companyDomain || company?.domain || "")}</span><small>{company?.inHubSpot ? `${company.accountType || "Existing"}${company.accountStatus ? ` · ${company.accountStatus}` : ""}` : row.precheck ? "Net-new company" : "Not checked"}</small></td><td>{row.stage === "checking" ? <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>Checking</span> : company?.protected || isExistingPerson(row) ? <><span className={styles.blockedBadge}><ShieldCheck size={11}/>Blocked</span><small>{company?.protectedReason || "Existing HubSpot person"}</small></> : row.precheck ? <><span className={styles.goodBadge}><CheckCircle2 size={11}/>Eligible</span><small>{company?.gateReason || "No blocker found"}</small></> : <span>Pending</span>}</td><td>{phone ? <strong className={styles.phone}><Phone size={11}/>{phone}</strong> : <span>No phone yet</span>}<small>{String(row.prospect?.email || existingEmail(row) || "") || (isExistingPerson(row) ? "Existing HubSpot contact" : "")}</small></td><td><strong>{ats || "—"}</strong>{career && <a href={career} target="_blank" rel="noreferrer">Career <ExternalLink size={10}/></a>}<small>{row.prospect && !ats && !career ? "Deferred for faster reveal" : ""}</small></td><td><strong>{row.stage === "ready" ? "Ready NEW" : row.stage === "needs-reveal" ? "Needs reveal" : row.stage === "revealing" ? "Revealing" : row.stage === "no-phone" ? "No phone" : row.stage === "pushed" ? "Pushed" : row.stage === "blocked" ? "Blocked" : row.stage === "error" ? "Error" : row.stage}</strong><small>{row.cachedReveal ? "Cached reveal · 0 credit" : row.message || row.error || ""}</small></td></tr>; })}
      {!visible.length && <tr><td colSpan={7}><div className={styles.empty}>{loading ? "Loading…" : "No rows in this view."}</div></td></tr>}
    </tbody></table></div></section>
  </div></main>;
}
