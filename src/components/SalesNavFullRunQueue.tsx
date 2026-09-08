"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Building2, CheckCircle2, CircleAlert, ExternalLink, Filter, LoaderCircle,
  Phone, Radar, RefreshCw, Send, ShieldCheck, Sparkles, UserCheck, UserPlus, UsersRound,
} from "lucide-react";
import styles from "./SalesNavFullRunQueue.module.css";

type SalesNavLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  connectionDegree: string;
  salesLeadUrl: string;
  linkedinUrl: string;
};

type FullRun = {
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
  clientVersion?: string;
  parserVersion?: string;
  leads: SalesNavLead[];
};

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
  openDeals: number;
  searchStatus: string;
  detectedAts: string;
  atsStatus: string;
  careerPageUrl: string;
  leadStatus: string;
  ownerId: string;
  engagementChecked: boolean;
  engagementError: string;
  engaged: boolean;
  connectedCallCount: number;
  meetingCount: number;
  latestConnectedCallAt: string;
  latestMeetingAt: string;
  latestEngagementAt: string;
  engagementReason: string;
  protected: boolean;
  protectedReason: string;
};

type Precheck = { contact: ContactCheck; company: CompanyCheck; checkedAt: string };

type HiringInsight = {
  status: "Hiring Now" | "Accepting Applications" | "No Active Jobs" | "Unknown";
  activeJobs: number;
  hiringScore?: number;
  hiringLabel?: string;
  hasHrJobs: boolean;
  source?: string;
  sourceUrl?: string;
  checkedAt?: string;
  jobsSample?: Array<{ title: string; location: string; url: string }>;
};

type Prospect = {
  uid: string;
  linkedinUrl: string;
  source: string;
  fullName: string;
  headline: string;
  location: string;
  title: string;
  company: string;
  companyWebsite: string;
  companyDomain: string;
  companyLinkedIn: string;
  companySize: string;
  staffCount: number | string | null;
  industry: string;
  careerPageUrl: string;
  detectedAts: string;
  atsConfidence: string;
  careerConfidence: number;
  companyEvidenceUrl: string;
  companyVerificationReason: string;
  hiring: HiringInsight;
  currentRoleStarted: string;
  previousTitle: string;
  previousCompany: string;
  email: string;
  emails: string[];
  emailConfidence: number | null;
  phone: string;
  phones: string[];
  phoneConfidence: number | null;
  recentSignal: { type: string; label: string; ageDays?: number | null };
  score: number;
  priority: "high" | "medium" | "normal";
  scoreReasons: Array<{ label: string; points: number }>;
  hubspot: { inHubSpot: boolean; id: string; matchedBy: string };
  hubspotContact?: { inHubSpot: boolean; id: string; matchedBy: string };
};

type Stage = "pending" | "checking" | "blocked" | "existing-ready" | "needs-reveal" | "revealing" | "revealed" | "pushed" | "error";
type Row = {
  key: string;
  lead: SalesNavLead;
  stage: Stage;
  precheck?: Precheck;
  prospect?: Prospect;
  error?: string;
  pushMessage?: string;
};

type View = "eligible" | "existing" | "blocked" | "revealed" | "all" | "review";

function keyFor(lead: SalesNavLead) {
  return lead.salesLeadUrl || lead.linkedinUrl || `${lead.name}:${lead.company}`;
}

function existingPhone(row: Row) {
  const properties = row.precheck?.contact.properties || {};
  return String(properties.mobilephone || properties.phone || "").trim();
}

function existingEmail(row: Row) {
  return String(row.precheck?.contact.properties?.email || "").trim();
}

function eligibleForReveal(row: Row) {
  return row.stage === "needs-reveal" && !row.precheck?.company.protected;
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function precheckLead(lead: SalesNavLead) {
  const response = await fetch("/api/prospecting/signalhire/precheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: lead.name,
      company: lead.company,
      linkedinUrl: lead.linkedinUrl,
      email: "",
      emails: [],
      phone: "",
      phones: [],
    }),
  });
  const payload = await readJson<Precheck & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "HubSpot precheck failed.");
  return payload;
}

async function revealLead(lead: SalesNavLead) {
  const response = await fetch("/api/prospecting/resolve-companion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      linkedinUrl: lead.linkedinUrl,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      location: lead.location,
      source: "Sales Nav Full Search",
    }),
  });
  const payload = await readJson<{ prospect?: Prospect; error?: string }>(response);
  if (!response.ok || !payload.prospect) throw new Error(payload.error || "SignalHire could not reveal this lead.");

  const intelResponse = await fetch("/api/prospecting/intelligence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      linkedinUrl: payload.prospect.linkedinUrl,
      company: payload.prospect.company,
      companyWebsite: payload.prospect.companyWebsite,
      companyDomain: payload.prospect.companyDomain,
      email: payload.prospect.email,
      emails: payload.prospect.emails,
      score: payload.prospect.score,
      scoreReasons: payload.prospect.scoreReasons,
    }),
  });
  const intel = await readJson<{ patch?: Partial<Prospect>; error?: string }>(intelResponse);
  if (!intelResponse.ok || !intel.patch) throw new Error(intel.error || "ATS / company intelligence failed.");
  return { ...payload.prospect, ...intel.patch, source: "Sales Nav Full Search" } as Prospect;
}

export function SalesNavFullRunQueue() {
  const [run, setRun] = useState<FullRun | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("eligible");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revealing, setRevealing] = useState(false);
  const [revealProgress, setRevealProgress] = useState({ done: 0, total: 0 });
  const [pushing, setPushing] = useState(false);

  async function loadRun() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/prospecting/salesnav/full-run", { cache: "no-store" });
      if (response.status === 401) {
        setUnauthorized(true);
        setRun(null);
        setRows([]);
        return;
      }
      const payload = await readJson<{ run?: FullRun | null; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Could not load full Sales Nav run.");
      setUnauthorized(false);
      setRun(payload.run || null);
      setRows((payload.run?.leads || []).map((lead) => ({ key: keyFor(lead), lead, stage: "pending" })));
      setSelected(new Set());
      setMessage(payload.run ? `${payload.run.total} unique leads saved from ${payload.run.pagesRead} Sales Navigator page${payload.run.pagesRead === 1 ? "" : "s"}. No SignalHire contact credits have been used by full capture.` : "No full Sales Navigator run has been captured yet.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load full Sales Nav run.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRun(); }, []);

  async function runPrecheck() {
    if (!rows.length || processing) return;
    setProcessing(true);
    setError("");
    setSelected(new Set());
    setProgress({ done: 0, total: rows.length });
    setRows((current) => current.map((row) => ({ ...row, stage: "pending", error: undefined, precheck: undefined, prospect: undefined, pushMessage: undefined })));
    const pending = [...rows];
    const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift();
        if (!source) return;
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "checking" } : row));
        try {
          const checked = await precheckLead(source.lead);
          const phoneAlready = String(checked.contact.properties?.mobilephone || checked.contact.properties?.phone || "").trim();
          const stage: Stage = checked.company.protected
            ? "blocked"
            : checked.contact.inHubSpot && phoneAlready
              ? "existing-ready"
              : "needs-reveal";
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, precheck: checked, stage } : row));
        } catch (requestError) {
          setRows((current) => current.map((row) => row.key === source.key ? {
            ...row,
            stage: "error",
            error: requestError instanceof Error ? requestError.message : "HubSpot precheck failed.",
          } : row));
        } finally {
          setProgress((current) => ({ ...current, done: current.done + 1 }));
        }
      }
    });
    await Promise.all(workers);
    setProcessing(false);
    setMessage("HubSpot gate finished. Meetings are blocked; connected calls without a meeting remain eligible. Reveal is still manual and only runs for the leads you select.");
  }

  async function revealSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && eligibleForReveal(row));
    if (!queue.length || revealing) return;
    if (!window.confirm(`Reveal ${queue.length} selected lead${queue.length === 1 ? "" : "s"} in SignalHire? This can use up to ${queue.length} Contact Credit${queue.length === 1 ? "" : "s"}.`)) return;
    setRevealing(true);
    setRevealProgress({ done: 0, total: queue.length });
    const pending = [...queue];
    const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
      while (pending.length) {
        const source = pending.shift();
        if (!source) return;
        setRows((current) => current.map((row) => row.key === source.key ? { ...row, stage: "revealing", error: undefined } : row));
        try {
          const prospect = await revealLead(source.lead);
          setRows((current) => current.map((row) => row.key === source.key ? { ...row, prospect, stage: "revealed" } : row));
        } catch (requestError) {
          setRows((current) => current.map((row) => row.key === source.key ? {
            ...row,
            stage: "error",
            error: requestError instanceof Error ? requestError.message : "SignalHire reveal failed.",
          } : row));
        } finally {
          setRevealProgress((current) => ({ ...current, done: current.done + 1 }));
        }
      }
    });
    await Promise.all(workers);
    setRevealing(false);
    setSelected(new Set());
    setMessage("Selected SignalHire reveals finished. Revealed rows now include phone/email plus ATS and career-page intelligence when verified.");
  }

  async function pushRevealed() {
    const queue = rows.filter((row) => selected.has(row.key) && row.stage === "revealed" && row.prospect);
    if (!queue.length || pushing) return;
    setPushing(true);
    for (const source of queue) {
      try {
        const response = await fetch("/api/prospecting/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(source.prospect),
        });
        const payload = await readJson<{ duplicate?: boolean; taskId?: string; ownerName?: string; error?: string }>(response);
        if (!response.ok) throw new Error(payload.error || "HubSpot push failed.");
        setRows((current) => current.map((row) => row.key === source.key ? {
          ...row,
          stage: "pushed",
          pushMessage: payload.duplicate ? `Task already exists · ${payload.taskId || "existing"}` : `Pushed to ${payload.ownerName || "Marita"} · Task ${payload.taskId || "created"}`,
        } : row));
      } catch (requestError) {
        setRows((current) => current.map((row) => row.key === source.key ? {
          ...row,
          error: requestError instanceof Error ? requestError.message : "HubSpot push failed.",
        } : row));
      }
    }
    setPushing(false);
    setSelected(new Set());
  }

  const counts = useMemo(() => ({
    total: rows.length,
    eligible: rows.filter((row) => row.stage === "needs-reveal").length,
    existingReady: rows.filter((row) => row.stage === "existing-ready").length,
    blocked: rows.filter((row) => row.stage === "blocked").length,
    existingCompanies: rows.filter((row) => row.precheck?.company.inHubSpot).length,
    connectedNoMeeting: rows.filter((row) => (row.precheck?.company.connectedCallCount || 0) > 0 && (row.precheck?.company.meetingCount || 0) === 0 && !row.precheck?.company.protected).length,
    revealed: rows.filter((row) => row.stage === "revealed" || row.stage === "pushed").length,
    review: rows.filter((row) => row.stage === "error").length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "eligible" && row.stage !== "needs-reveal") return false;
      if (view === "existing" && row.stage !== "existing-ready") return false;
      if (view === "blocked" && row.stage !== "blocked") return false;
      if (view === "revealed" && row.stage !== "revealed" && row.stage !== "pushed") return false;
      if (view === "review" && row.stage !== "error") return false;
      if (!term) return true;
      return [
        row.lead.name, row.lead.title, row.lead.company, row.lead.location,
        row.precheck?.company.accountType, row.precheck?.company.accountStatus, row.precheck?.company.detectedAts,
        row.prospect?.email, row.prospect?.phone, row.prospect?.companyDomain, row.prospect?.detectedAts,
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [query, rows, view]);

  const selectable = visible.filter((row) => eligibleForReveal(row) || row.stage === "revealed");
  const allSelectable = selectable.length > 0 && selectable.every((row) => selected.has(row.key));
  const selectedReveal = rows.filter((row) => selected.has(row.key) && eligibleForReveal(row)).length;
  const selectedPush = rows.filter((row) => selected.has(row.key) && row.stage === "revealed" && row.prospect).length;

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of selectable) {
        if (allSelectable) next.delete(row.key);
        else next.add(row.key);
      }
      return next;
    });
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.back}><ArrowLeft size={15}/>SDR Command Center</Link>
          <span className={styles.eyebrow}><Radar size={14}/>SALES NAV FULL SEARCH</span>
          <h1>Sales Navigator → HubSpot gate → SignalHire reveal</h1>
          <p>The Chrome Companion captures each Sales Navigator page first. HubSpot is checked before any contact reveal, so meeting-blocked or already-covered leads do not waste SignalHire credits.</p>
        </div>
        <div className={styles.runtime}><span data-ok={Boolean(run)}><ShieldCheck size={13}/>{run ? `${run.total} saved leads` : "No saved run"}</span></div>
      </header>

      {unauthorized && <section className={styles.warning}><CircleAlert size={16}/><div><strong>Sales Nav setup is locked.</strong><span>Open Companion setup, unlock it once on this browser, then return here.</span><Link href="/salesnav-prospecting">Open Companion setup</Link></div></section>}
      {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
      {message && <div className={styles.notice}><CheckCircle2 size={15}/>{message}</div>}
      {loading && <div className={styles.notice}><LoaderCircle className={styles.spin} size={15}/>Loading saved full run…</div>}

      <section className={styles.runCard}>
        <div>
          <strong>{run ? `${run.pagesRead} pages · ${run.total} unique leads` : "No full run yet"}</strong>
          <span>{run?.complete ? `Completed · ${run.stopReason || "Finished"}` : run ? "Capture is resumable from the Chrome Companion" : "Open a Sales Navigator People Search and press Capture full search in the extension."}</span>
          {run?.sourceUrl && <a href={run.sourceUrl} target="_blank" rel="noreferrer">Open source search <ExternalLink size={11}/></a>}
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => void loadRun()} disabled={loading}><RefreshCw size={14}/>Reload run</button>
          <button type="button" className={styles.primary} onClick={() => void runPrecheck()} disabled={!rows.length || processing}>{processing ? <LoaderCircle className={styles.spin} size={14}/> : <ShieldCheck size={14}/>}HubSpot precheck</button>
        </div>
      </section>

      {processing && <div className={styles.notice}><LoaderCircle className={styles.spin} size={15}/>HubSpot check {progress.done}/{progress.total} · no SignalHire contact credits…</div>}
      {revealing && <div className={styles.notice}><LoaderCircle className={styles.spin} size={15}/>SignalHire reveal {revealProgress.done}/{revealProgress.total} · only selected eligible leads…</div>}

      <section className={styles.metrics}>
        <article><UsersRound size={17}/><span>Saved</span><strong>{counts.total}</strong></article>
        <article><UserPlus size={17}/><span>Need reveal</span><strong>{counts.eligible}</strong></article>
        <article><UserCheck size={17}/><span>HubSpot phone ready</span><strong>{counts.existingReady}</strong></article>
        <article><Building2 size={17}/><span>Existing companies</span><strong>{counts.existingCompanies}</strong></article>
        <article><Phone size={17}/><span>Connected / no meeting</span><strong>{counts.connectedNoMeeting}</strong></article>
        <article><ShieldCheck size={17}/><span>Meeting blocked</span><strong>{counts.blocked}</strong></article>
        <article><Sparkles size={17}/><span>Revealed</span><strong>{counts.revealed}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.views}>
          <button data-active={view === "eligible"} onClick={() => setView("eligible")}>Need reveal <b>{counts.eligible}</b></button>
          <button data-active={view === "existing"} onClick={() => setView("existing")}>HubSpot ready <b>{counts.existingReady}</b></button>
          <button data-active={view === "blocked"} onClick={() => setView("blocked")}>Blocked <b>{counts.blocked}</b></button>
          <button data-active={view === "revealed"} onClick={() => setView("revealed")}>Revealed <b>{counts.revealed}</b></button>
          <button data-active={view === "all"} onClick={() => setView("all")}>All <b>{counts.total}</b></button>
          <button data-active={view === "review"} onClick={() => setView("review")}>Review <b>{counts.review}</b></button>
        </div>
        <label className={styles.search}><Filter size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, company, ATS, status…"/></label>
      </section>

      <section className={styles.selection}>
        <button type="button" onClick={toggleVisible}>{allSelectable ? "Unselect visible" : "Select visible"}</button>
        <span><strong>{selected.size}</strong> selected</span>
        <button type="button" className={styles.reveal} disabled={!selectedReveal || revealing} onClick={() => void revealSelected()}><Sparkles size={14}/>Reveal selected ({selectedReveal})</button>
        <button type="button" className={styles.push} disabled={!selectedPush || pushing} onClick={() => void pushRevealed()}>{pushing ? <LoaderCircle className={styles.spin} size={14}/> : <Send size={14}/>}Push + Tasks ({selectedPush})</button>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}><div><h2>Full-search queue</h2><p>Meeting = block. Connected call without meeting = eligible. SignalHire reveal only happens after your explicit selection.</p></div><span>{visible.length} visible</span></div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th/><th>Person</th><th>Company</th><th>HubSpot gate</th><th>Contact</th><th>ATS / Career</th><th>Status</th></tr></thead>
            <tbody>
              {visible.map((row) => {
                const company = row.precheck?.company;
                const contact = row.precheck?.contact;
                const canSelect = eligibleForReveal(row) || row.stage === "revealed";
                return <tr key={row.key}>
                  <td><input type="checkbox" disabled={!canSelect} checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}/></td>
                  <td><strong>{row.prospect?.fullName || row.lead.name}</strong><span>{row.prospect?.title || row.lead.title || "—"}</span><small>{row.lead.location || "—"}</small>{row.lead.salesLeadUrl && <a href={row.lead.salesLeadUrl} target="_blank" rel="noreferrer">Sales Nav <ExternalLink size={10}/></a>}</td>
                  <td><strong>{row.prospect?.company || company?.name || row.lead.company || "—"}</strong><span>{row.prospect?.companyDomain || company?.domain || ""}</span><small>{company?.inHubSpot ? `${company.accountType || "Existing"}${company.accountStatus ? ` · ${company.accountStatus}` : ""}` : row.precheck ? "New company" : "Not checked"}</small></td>
                  <td>{row.stage === "checking" ? <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>Checking</span> : company?.protected ? <span className={styles.blocked}><ShieldCheck size={11}/>{company.protectedReason || "Blocked"}</span> : row.precheck ? <><span className={styles.good}><CheckCircle2 size={11}/>Eligible</span><small>{company.connectedCallCount ? `${company.connectedCallCount} connected call${company.connectedCallCount === 1 ? "" : "s"} · no meeting` : "No meeting found"}</small></> : <span>Pending</span>}</td>
                  <td>{row.prospect?.phone ? <strong className={styles.phone}><Phone size={11}/>{row.prospect.phone}</strong> : existingPhone(row) ? <strong className={styles.phone}><Phone size={11}/>{existingPhone(row)}</strong> : <span>No phone yet</span>}<small>{row.prospect?.email || existingEmail(row) || (contact?.inHubSpot ? `Existing contact · ${contact.matchedBy}` : row.precheck ? "New / unmatched contact" : "")}</small></td>
                  <td><strong>{row.prospect?.detectedAts || company?.detectedAts || "—"}</strong>{row.prospect?.careerPageUrl || company?.careerPageUrl ? <a href={row.prospect?.careerPageUrl || company?.careerPageUrl} target="_blank" rel="noreferrer">Career page <ExternalLink size={10}/></a> : <small>No verified career page yet</small>}</td>
                  <td>{row.stage === "pending" && <span>Pending</span>}{row.stage === "checking" && <span>HubSpot check</span>}{row.stage === "blocked" && <span className={styles.blocked}>Meeting / review block</span>}{row.stage === "existing-ready" && <span className={styles.good}>0-credit · HubSpot phone</span>}{row.stage === "needs-reveal" && <span className={styles.badge}>Needs SignalHire reveal</span>}{row.stage === "revealing" && <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>Revealing</span>}{row.stage === "revealed" && <span className={styles.good}>Revealed · ready to push</span>}{row.stage === "pushed" && <span className={styles.good}>{row.pushMessage || "Pushed + task"}</span>}{row.stage === "error" && <span className={styles.errorText}>{row.error || "Error"}</span>}</td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={7} className={styles.empty}>{rows.length ? "No rows match this view." : "Capture a full Sales Navigator search from the Chrome Companion first."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>;
}
