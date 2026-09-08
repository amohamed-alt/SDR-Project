"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarClock, CheckCircle2, CircleAlert, ExternalLink, History,
  LoaderCircle, Phone, RefreshCw, Search, Send, ShieldCheck, Sparkles, UserRoundCheck, UsersRound,
} from "lucide-react";
import styles from "./SalesNavPipeline.module.css";

type Lead = {
  name: string;
  title: string;
  company: string;
  location: string;
  connectionDegree: string;
  salesLeadUrl: string;
  linkedinUrl: string;
};

type Run = {
  id: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string;
  complete: boolean;
  stopReason: string;
  sourceUrl: string;
  searchFingerprint: string;
  pagesRead: number;
  total: number;
  leads: Lead[];
};

type RunSummary = Omit<Run, "leads">;
type ContactCheck = {
  inHubSpot: boolean;
  id: string;
  matchedBy: string;
  properties?: Record<string, unknown>;
};
type CompanyCheck = {
  inHubSpot: boolean;
  id: string;
  matchedBy: string;
  name: string;
  domain: string;
  accountType: string;
  accountStatus: string;
  detectedAts: string;
  careerPageUrl: string;
  protected: boolean;
  protectedReason: string;
  gateReason?: string;
  connectedCallCount: number;
  meetingCount: number;
  latestConnectedCallAt: string;
  recentConnectedCall?: boolean;
  connectedCallAgeDays?: number | null;
  engagementChecked: boolean;
  engagementError: string;
};
type Precheck = { contact: ContactCheck; company: CompanyCheck; checkedAt?: string };
type Prospect = Record<string, unknown> & {
  fullName?: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  phone?: string;
  phones?: string[];
  email?: string;
  emails?: string[];
  detectedAts?: string;
  careerPageUrl?: string;
  companyDomain?: string;
};
type Stage = "pending" | "checking" | "blocked" | "needs-reveal" | "revealing" | "ready" | "no-phone" | "pushed" | "error";
type Row = {
  key: string;
  lead: Lead;
  stage: Stage;
  precheck?: Precheck;
  prospect?: Prospect;
  error?: string;
  message?: string;
  cachedReveal?: boolean;
};
type Owner = { id: string; name: string };
type View = "ready" | "needs-reveal" | "blocked" | "pushed" | "review" | "all";

function keyFor(lead: Lead) {
  return lead.linkedinUrl || lead.salesLeadUrl || `${lead.name}:${lead.company}`;
}

function unique(values: unknown[]) {
  const seen = new Set<string>();
  return values.map((value) => String(value || "").trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function existingPhone(row: Row) {
  const p = row.precheck?.contact.properties || {};
  return String(p.mobilephone || p.phone || "").trim();
}

function existingEmail(row: Row) {
  return String(row.precheck?.contact.properties?.email || "").trim();
}

function prospectPhones(row: Row) {
  return unique([row.prospect?.phone, ...(Array.isArray(row.prospect?.phones) ? row.prospect?.phones || [] : [])]);
}

function readyPhone(row: Row) {
  return prospectPhones(row)[0] || existingPhone(row);
}

function isRetention(row: Row) {
  return String(row.precheck?.company.accountType || "").trim().toLowerCase() === "retention";
}

function tomorrowLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function runLabel(run: RunSummary) {
  const date = new Date(run.startedAt || run.updatedAt);
  const stamp = Number.isNaN(date.getTime()) ? "Saved run" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  return `${stamp} · ${run.pagesRead}p · ${run.total} leads${run.complete ? "" : " · running"}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Server returned non-JSON: ${text.slice(0, 160)}`); }
}

async function precheckLead(lead: Lead) {
  const response = await fetch("/api/prospecting/signalhire/precheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: lead.name, company: lead.company, linkedinUrl: lead.linkedinUrl, email: "", emails: [], phone: "", phones: [] }),
  });
  const payload = await readJson<Precheck & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "HubSpot precheck failed.");
  return payload;
}

export function SalesNavPipeline() {
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
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/prospecting/salesnav/full-run${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
      if (response.status === 401) {
        setUnauthorized(true);
        setRun(null);
        setRows([]);
        return;
      }
      const payload = await readJson<{ run?: Run | null; history?: RunSummary[]; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Could not load Sales Nav runs.");
      setUnauthorized(false);
      setRun(payload.run || null);
      setHistory(payload.history || []);
      setRows((payload.run?.leads || []).map((lead) => ({ key: keyFor(lead), lead, stage: "pending" })));
      setSelected(new Set());
      setView("ready");
      setMessage(payload.run ? `${payload.run.total} leads loaded. Run HubSpot Check before revealing anything.` : "No Sales Navigator full-search run found yet.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load Sales Nav runs.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    void loadRun();
    fetch("/api/prospecting/salesnav/task-options", { cache: "no-store" })
      .then(async (response) => {
        const payload = await readJson<{ owners?: Owner[]; defaultOwner?: Owner | null; error?: string }>(response);
        if (!response.ok) throw new Error(payload.error || "Could not load task owners.");
        setOwners(payload.owners || []);
        if (payload.defaultOwner?.id) setOwnerId(payload.defaultOwner.id);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Could not load task owners."));
  }, []);

  async function runPrecheck() {
    if (!rows.length || processing) return;
    setProcessing(true);
    setError("");
    setSelected(new Set());
    setProgress({ done: 0, total: rows.length, label: "HubSpot check" });
    setRows((current) => current.map((row) => ({ ...row, stage: "pending", precheck: undefined, prospect: undefined, error: undefined, message: undefined })));
    const pending = [...rows];
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift();
        if (!source) return;
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "checking" } : row));
        try {
          const checked = await precheckLead(source.lead);
          const temp: Row = { ...source, precheck: checked, stage: "pending" };
          const stage: Stage = checked.company.protected ? "blocked" : existingPhone(temp) ? "ready" : "needs-reveal";
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, precheck: checked, stage } : row));
        } catch (requestError) {
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "HubSpot check failed." } : row));
        } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
      }
    });
    await Promise.all(workers);
    setProcessing(false);
    setMessage("HubSpot gate complete: Retention, meetings, recent connected calls and incomplete communication checks are blocked. Old connected calls without a meeting stay eligible.");
  }

  async function revealSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && row.stage === "needs-reveal");
    if (!queue.length || revealing) return;
    if (!window.confirm(`Reveal ${queue.length} eligible lead${queue.length === 1 ? "" : "s"}? Previously revealed people are reused from history for 0 new credits; only first-time reveals can consume a SignalHire Contact Credit.`)) return;
    setRevealing(true);
    setError("");
    setProgress({ done: 0, total: queue.length, label: "SignalHire reveal" });
    for (const source of queue) {
      setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "revealing", error: undefined } : row));
      try {
        const response = await fetch("/api/prospecting/salesnav/reveal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run?.id || "", lead: source.lead }),
        });
        const payload = await readJson<{ prospect?: Prospect | null; postRevealCheck?: Precheck; hasPhone?: boolean; cached?: boolean; creditUsed?: boolean; message?: string; error?: string }>(response);
        if (!response.ok) throw new Error(payload.error || "SignalHire reveal failed.");
        const checked = payload.postRevealCheck || source.precheck;
        const nextRow: Row = { ...source, precheck: checked, prospect: payload.prospect || undefined, cachedReveal: Boolean(payload.cached), message: payload.message };
        const phone = prospectPhones(nextRow)[0] || existingPhone(nextRow);
        const stage: Stage = checked?.company.protected ? "blocked" : phone ? "ready" : "no-phone";
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, ...nextRow, stage } : row));
      } catch (requestError) {
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "Reveal failed." } : row));
      } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
    }
    setSelected(new Set());
    setRevealing(false);
    setView("ready");
    setMessage("Reveal pass finished. Ready now means a verified eligible row with a phone number; cached reveals did not request another SignalHire credit.");
  }

  function taskDueIso() {
    const date = new Date(`${dueDate}T${dueTime}:00`);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  async function pushSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && row.stage === "ready" && readyPhone(row));
    if (!queue.length || pushing) return;
    if (!ownerId) { setError("Choose the task owner first."); return; }
    const dueAt = taskDueIso();
    if (!dueAt) { setError("Choose a valid task date and time."); return; }
    const ownerName = owners.find((owner) => owner.id === ownerId)?.name || "selected owner";
    if (!window.confirm(`Push ${queue.length} Ready lead${queue.length === 1 ? "" : "s"} and create CALL task${queue.length === 1 ? "" : "s"} for ${ownerName} on ${dueDate} at ${dueTime}?`)) return;

    setPushing(true);
    setError("");
    setProgress({ done: 0, total: queue.length, label: "Push + Tasks" });
    for (const source of queue) {
      try {
        const response = await fetch("/api/prospecting/salesnav/push-ready", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: run?.id || "",
            taskOwnerId: ownerId,
            taskDueAt: dueAt,
            existingPhone: existingPhone(source),
            existingEmail: existingEmail(source),
            lead: source.lead,
            precheck: source.precheck,
            prospect: source.prospect || null,
          }),
        });
        const payload = await readJson<{ duplicate?: boolean; taskId?: string; ownerName?: string; dueAt?: string; message?: string; error?: string }>(response);
        if (!response.ok) throw new Error(payload.error || "Push + Task failed.");
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "pushed", message: payload.duplicate ? `Existing task kept · ${payload.taskId || "found"}` : `Task ${payload.taskId || "created"} → ${payload.ownerName || ownerName} · ${dueDate} ${dueTime}` } : row));
      } catch (requestError) {
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "Push failed." } : row));
      } finally { setProgress((current) => ({ ...current, done: current.done + 1 })); }
    }
    setSelected(new Set());
    setPushing(false);
    setView("pushed");
    setMessage("Push pass finished. Existing open Sales Signal tasks were deduped; new tasks used the owner/date/time you selected.");
  }

  const counts = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((row) => row.stage === "ready" && readyPhone(row)).length,
    reveal: rows.filter((row) => row.stage === "needs-reveal").length,
    blocked: rows.filter((row) => row.stage === "blocked").length,
    retention: rows.filter((row) => row.stage === "blocked" && isRetention(row)).length,
    recentCalls: rows.filter((row) => row.stage === "blocked" && row.precheck?.company.recentConnectedCall).length,
    oldCalls: rows.filter((row) => !row.precheck?.company.protected && (row.precheck?.company.connectedCallCount || 0) > 0 && !row.precheck?.company.recentConnectedCall).length,
    pushed: rows.filter((row) => row.stage === "pushed").length,
    review: rows.filter((row) => row.stage === "error" || row.stage === "no-phone").length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "ready" && row.stage !== "ready") return false;
      if (view === "needs-reveal" && row.stage !== "needs-reveal") return false;
      if (view === "blocked" && row.stage !== "blocked") return false;
      if (view === "pushed" && row.stage !== "pushed") return false;
      if (view === "review" && row.stage !== "error" && row.stage !== "no-phone") return false;
      if (!term) return true;
      return [row.lead.name, row.lead.title, row.lead.company, row.lead.location, row.precheck?.company.gateReason, row.precheck?.company.accountType, row.prospect?.detectedAts, row.prospect?.phone].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [query, rows, view]);

  const selectable = visible.filter((row) => row.stage === "ready" || row.stage === "needs-reveal");
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.key));
  const selectedReveal = rows.filter((row) => selected.has(row.key) && row.stage === "needs-reveal").length;
  const selectedPush = rows.filter((row) => selected.has(row.key) && row.stage === "ready" && readyPhone(row)).length;
  const ownerName = owners.find((owner) => owner.id === ownerId)?.name || "—";

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of selectable) allSelected ? next.delete(row.key) : next.add(row.key);
      return next;
    });
  }

  if (unauthorized) return <main className={styles.page}><div className={styles.shell}><section className={styles.warning}><CircleAlert size={18}/><div><strong>Sales Nav setup is locked.</strong><span>Unlock Companion setup on this browser, then return to the queue.</span><Link href="/salesnav-prospecting">Open Companion setup</Link></div></section></div></main>;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div><Link href="/" className={styles.back}><ArrowLeft size={15}/>SDR Command Center</Link><span className={styles.eyebrow}><ShieldCheck size={14}/>SALES NAV → HUBSPOT → SIGNALHIRE</span><h1>Persistent Prospecting Queue</h1><p>Every search run stays in history. HubSpot is checked first; SignalHire is manual; Ready means phone available.</p></div>
        <div className={styles.headerStats}><span><History size={13}/>{history.length} saved runs</span><span><Phone size={13}/>{counts.ready} phone-ready</span></div>
      </header>

      {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
      {message && <div className={styles.notice}><CheckCircle2 size={15}/>{message}</div>}
      {(loading || processing || revealing || pushing) && <div className={styles.progress}><LoaderCircle className={styles.spin} size={15}/>{loading ? "Loading…" : `${progress.label} ${progress.done}/${progress.total}`}</div>}

      <section className={styles.runBar}>
        <div className={styles.runSelect}><label>Search history</label><select value={run?.id || ""} onChange={(event) => void loadRun(event.target.value)} disabled={loading}>{history.map((item) => <option key={item.id} value={item.id}>{runLabel(item)}</option>)}</select><small>{run ? `${run.pagesRead} pages · ${run.total} unique leads · ${run.complete ? run.stopReason || "completed" : "capture can resume"}` : "No run loaded"}</small></div>
        <div className={styles.runActions}><button onClick={() => void loadRun(run?.id || "")} disabled={loading}><RefreshCw size={14}/>Reload</button><button className={styles.primary} onClick={() => void runPrecheck()} disabled={!rows.length || processing}><ShieldCheck size={14}/>HubSpot Check</button>{run?.sourceUrl && <a href={run.sourceUrl} target="_blank" rel="noreferrer">Open Sales Nav <ExternalLink size={11}/></a>}</div>
      </section>

      <section className={styles.metrics}>
        <article><UsersRound size={16}/><span>Saved</span><strong>{counts.total}</strong></article>
        <article><Phone size={16}/><span>Ready · phone</span><strong>{counts.ready}</strong></article>
        <article><Sparkles size={16}/><span>Needs reveal</span><strong>{counts.reveal}</strong></article>
        <article><ShieldCheck size={16}/><span>Blocked</span><strong>{counts.blocked}</strong></article>
        <article><UserRoundCheck size={16}/><span>Retention</span><strong>{counts.retention}</strong></article>
        <article><Phone size={16}/><span>Recent calls blocked</span><strong>{counts.recentCalls}</strong></article>
        <article><CheckCircle2 size={16}/><span>Old calls eligible</span><strong>{counts.oldCalls}</strong></article>
        <article><Send size={16}/><span>Pushed</span><strong>{counts.pushed}</strong></article>
      </section>

      <section className={styles.dispatch}>
        <div><label>Task owner</label><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></div>
        <div><label>Due date</label><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)}/></div>
        <div><label>Time</label><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)}/></div>
        <div className={styles.dispatchSummary}><CalendarClock size={15}/><span>CALL tasks → <b>{ownerName}</b> → {dueDate} {dueTime}</span></div>
        <button className={styles.revealButton} disabled={!selectedReveal || revealing} onClick={() => void revealSelected()}><Sparkles size={14}/>Reveal selected ({selectedReveal})</button>
        <button className={styles.pushButton} disabled={!selectedPush || pushing} onClick={() => void pushSelected()}><Send size={14}/>Push Ready + Tasks ({selectedPush})</button>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.tabs}>
          <button data-active={view === "ready"} onClick={() => setView("ready")}>Ready <b>{counts.ready}</b></button>
          <button data-active={view === "needs-reveal"} onClick={() => setView("needs-reveal")}>Need reveal <b>{counts.reveal}</b></button>
          <button data-active={view === "blocked"} onClick={() => setView("blocked")}>Blocked <b>{counts.blocked}</b></button>
          <button data-active={view === "pushed"} onClick={() => setView("pushed")}>Pushed <b>{counts.pushed}</b></button>
          <button data-active={view === "review"} onClick={() => setView("review")}>Review <b>{counts.review}</b></button>
          <button data-active={view === "all"} onClick={() => setView("all")}>All <b>{counts.total}</b></button>
        </div>
        <label className={styles.search}><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, company, status, ATS…"/></label>
      </section>

      <section className={styles.selection}><button onClick={toggleVisible}>{allSelected ? "Unselect visible" : "Select visible"}</button><span><b>{selected.size}</b> selected · {selectedReveal} reveal · {selectedPush} push-ready</span></section>

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}><div><h2>Review queue</h2><p>Retention = block · Meeting = block · Connected ≤30d = block · Connected &gt;30d with no meeting = eligible · Ready = phone available.</p></div><span>{visible.length} visible</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th/><th>Person</th><th>Company</th><th>HubSpot gate</th><th>Contact</th><th>ATS / Career</th><th>Status</th></tr></thead><tbody>
          {visible.map((row) => {
            const company = row.precheck?.company;
            const phone = readyPhone(row);
            const canSelect = row.stage === "ready" || row.stage === "needs-reveal";
            const ats = String(row.prospect?.detectedAts || company?.detectedAts || "");
            const career = String(row.prospect?.careerPageUrl || company?.careerPageUrl || "");
            return <tr key={row.key} data-blocked={row.stage === "blocked"}>
              <td><input type="checkbox" disabled={!canSelect} checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; })}/></td>
              <td><strong>{String(row.prospect?.fullName || row.lead.name)}</strong><span>{String(row.prospect?.title || row.lead.title || "—")}</span><small>{String(row.prospect?.location || row.lead.location || "—")}</small><div className={styles.links}>{row.lead.salesLeadUrl && <a href={row.lead.salesLeadUrl} target="_blank" rel="noreferrer">Sales Nav <ExternalLink size={10}/></a>}{row.prospect?.linkedinUrl && <a href={String(row.prospect.linkedinUrl)} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={10}/></a>}</div></td>
              <td><strong>{String(row.prospect?.company || company?.name || row.lead.company || "—")}</strong><span>{String(row.prospect?.companyDomain || company?.domain || "")}</span><small>{company?.inHubSpot ? `${company.accountType || "Existing"}${company.accountStatus ? ` · ${company.accountStatus}` : ""}` : row.precheck ? "Net-new company" : "Not checked"}</small></td>
              <td>{row.stage === "checking" ? <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>Checking</span> : company?.protected ? <><span className={styles.blockedBadge}><ShieldCheck size={11}/>Blocked</span><small>{company.protectedReason}</small></> : row.precheck ? <><span className={styles.goodBadge}><CheckCircle2 size={11}/>Eligible</span><small>{company?.gateReason || "No blocker found"}</small></> : <span>Pending</span>} {row.precheck?.contact.inHubSpot && <small>Person matched · {row.precheck.contact.matchedBy}</small>}</td>
              <td>{phone ? <strong className={styles.phone}><Phone size={11}/>{phone}</strong> : <span>No phone yet</span>}<small>{String(row.prospect?.email || existingEmail(row) || "") || (row.precheck?.contact.inHubSpot ? "Existing HubSpot contact" : "")}</small></td>
              <td><strong>{ats || "No ATS verified"}</strong>{career ? <a href={career} target="_blank" rel="noreferrer">Career page <ExternalLink size={10}/></a> : <small>No verified career page yet</small>}</td>
              <td>{row.stage === "pending" && <span>Pending check</span>}{row.stage === "checking" && <span>Checking HubSpot</span>}{row.stage === "blocked" && <span className={styles.blockedText}>Blocked</span>}{row.stage === "needs-reveal" && <span className={styles.badge}>Eligible · needs reveal</span>}{row.stage === "revealing" && <span className={styles.badge}>Revealing…</span>}{row.stage === "ready" && <span className={styles.goodText}>{row.cachedReveal ? "Ready · cached reveal · 0 new credits" : row.prospect ? "Ready · phone revealed" : "Ready · HubSpot phone · 0 credits"}</span>}{row.stage === "no-phone" && <span className={styles.warnText}>Reveal complete · no phone</span>}{row.stage === "pushed" && <span className={styles.goodText}>{row.message || "Pushed + task"}</span>}{row.stage === "error" && <span className={styles.errorText}>{row.error || "Needs review"}</span>}{row.error && row.stage !== "error" && <small className={styles.errorText}>{row.error}</small>}</td>
            </tr>;
          })}
          {!visible.length && <tr><td colSpan={7} className={styles.empty}>{rows.length ? "No rows match this view." : "Capture a Sales Navigator full search first."}</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  </main>;
}
