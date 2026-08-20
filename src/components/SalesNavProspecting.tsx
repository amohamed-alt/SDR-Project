"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Building2, CheckCircle2, CircleAlert, ExternalLink, Filter, KeyRound, LoaderCircle,
  Mail, Phone, Radar, Save, Search, Settings2, ShieldCheck, Sparkles, UserPlus, UsersRound,
} from "lucide-react";
import styles from "./SalesNavProspecting.module.css";

type SalesNavLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  connectionDegree: string;
  salesLeadUrl: string;
  linkedinUrl: string;
  rawText?: string;
};

type HiringInsight = {
  status: "Hiring Now" | "Accepting Applications" | "No Active Jobs" | "Unknown";
  activeJobs: number;
  hasHrJobs: boolean;
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
  companySize: string;
  staffCount: number | string | null;
  industry: string;
  careerPageUrl: string;
  detectedAts: string;
  atsConfidence: string;
  email: string;
  emails: string[];
  emailConfidence: number | null;
  phone: string;
  phones: string[];
  phoneConfidence: number | null;
  score: number;
  priority: "high" | "medium" | "normal";
  scoreReasons: Array<{ label: string; points: number }>;
  hiring: HiringInsight;
  hubspot: { inHubSpot: boolean; id: string; matchedBy: string };
  hubspotContact?: { inHubSpot: boolean; id: string; matchedBy: string };
};

type Row = {
  key: string;
  salesNav: SalesNavLead;
  prospect?: Prospect;
  stage: "extracted" | "enriching" | "ready" | "error" | "skipped";
  error?: string;
};

type Runtime = {
  sessionConfigured: boolean;
  signalHireConfigured: boolean;
  maxResults: number;
};

type SessionStatus = {
  configured: boolean;
  unlocked: boolean;
  updatedAt?: string;
  source?: string;
};

type ExtractResponse = {
  status?: string;
  error?: string;
  pagesRead?: number;
  extracted?: number;
  resolvable?: number;
  unresolved?: number;
  leads?: SalesNavLead[];
};

type ResolveResponse = { prospect?: Prospect; error?: string };
type IntelligenceResponse = { patch?: Partial<Prospect>; error?: string };
type View = "net-new" | "new-people" | "all" | "review";

const MAX_RESULTS = 50;

function normalizedDegree(value: string) {
  return String(value || "").toLowerCase();
}

function isFirstDegree(row: Row) {
  return normalizedDegree(row.salesNav.connectionDegree) === "1st";
}

function isNetNew(row: Row) {
  return row.stage === "ready"
    && !isFirstDegree(row)
    && !row.prospect?.hubspot.inHubSpot
    && !row.prospect?.hubspotContact?.inHubSpot;
}

function isNewPerson(row: Row) {
  return row.stage === "ready"
    && !isFirstDegree(row)
    && Boolean(row.prospect?.hubspot.inHubSpot)
    && !row.prospect?.hubspotContact?.inHubSpot;
}

function contactability(row: Row) {
  if (row.prospect?.phone) return "Phone";
  if (row.prospect?.email) return "Email";
  return "No contact data";
}

function companyStatus(row: Row) {
  if (row.stage !== "ready") return "Checking";
  return row.prospect?.hubspot.inHubSpot ? "Existing company" : "New company";
}

function personStatus(row: Row) {
  if (isFirstDegree(row)) return "1st-degree";
  if (row.stage !== "ready") return "Checking";
  return row.prospect?.hubspotContact?.inHubSpot ? "Existing contact" : "New person";
}

export function SalesNavProspecting() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [searchUrl, setSearchUrl] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [view, setView] = useState<View>("net-new");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [setupKey, setSetupKey] = useState("");
  const [liAt, setLiAt] = useState("");
  const [jsessionId, setJsessionId] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");

  async function refreshRuntime() {
    try {
      const response = await fetch("/api/prospecting/salesnav", { cache: "no-store" });
      const payload = await response.json() as Runtime;
      setRuntime(payload);
    } catch {
      setRuntime({ sessionConfigured: false, signalHireConfigured: false, maxResults: MAX_RESULTS });
    }
  }

  async function refreshSessionStatus() {
    try {
      const response = await fetch("/api/prospecting/salesnav/session", { cache: "no-store" });
      const payload = await response.json() as SessionStatus;
      setSessionStatus(payload);
    } catch {
      setSessionStatus({ configured: false, unlocked: false });
    }
  }

  useEffect(() => {
    void refreshRuntime();
    void refreshSessionStatus();
  }, []);

  async function unlockSessionSettings() {
    if (!setupKey.trim()) return;
    setSessionBusy(true);
    setSessionMessage("");
    try {
      const response = await fetch("/api/prospecting/salesnav/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", setupKey: setupKey.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not unlock session settings.");
      setSetupKey("");
      setSessionMessage("Session settings unlocked on this browser.");
      await refreshSessionStatus();
    } catch (requestError) {
      setSessionMessage(requestError instanceof Error ? requestError.message : "Could not unlock session settings.");
    } finally {
      setSessionBusy(false);
    }
  }

  async function saveSession() {
    if (!liAt.trim()) {
      setSessionMessage("Paste li_at first.");
      return;
    }
    setSessionBusy(true);
    setSessionMessage("");
    try {
      const response = await fetch("/api/prospecting/salesnav/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", liAt: liAt.trim(), jsessionId: jsessionId.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save LinkedIn session.");
      setLiAt("");
      setJsessionId("");
      setSessionMessage("LinkedIn session saved. You can run Sales Nav now.");
      await Promise.all([refreshRuntime(), refreshSessionStatus()]);
    } catch (requestError) {
      setSessionMessage(requestError instanceof Error ? requestError.message : "Could not save LinkedIn session.");
    } finally {
      setSessionBusy(false);
    }
  }

  async function enrichLead(lead: SalesNavLead): Promise<Row> {
    const key = lead.linkedinUrl || lead.salesLeadUrl || `${lead.name}:${lead.company}`;
    if (normalizedDegree(lead.connectionDegree) === "1st") {
      return { key, salesNav: lead, stage: "skipped", error: "1st-degree connection — skipped before SignalHire." };
    }
    if (!lead.linkedinUrl) {
      return { key, salesNav: lead, stage: "error", error: "Public LinkedIn profile URL was not resolved." };
    }

    try {
      const fastResponse = await fetch("/api/prospecting/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedinUrl: lead.linkedinUrl, source: "Sales Navigator Search" }),
      });
      const fast = await fastResponse.json() as ResolveResponse;
      if (!fastResponse.ok || !fast.prospect) throw new Error(fast.error || "SignalHire could not resolve this person.");

      const baseProspect = fast.prospect;
      const intelResponse = await fetch("/api/prospecting/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedinUrl: baseProspect.linkedinUrl,
          company: baseProspect.company,
          companyWebsite: baseProspect.companyWebsite,
          companyDomain: baseProspect.companyDomain,
          email: baseProspect.email,
          emails: baseProspect.emails,
          score: baseProspect.score,
          scoreReasons: baseProspect.scoreReasons,
        }),
      });
      const intel = await intelResponse.json() as IntelligenceResponse;
      if (!intelResponse.ok || !intel.patch) throw new Error(intel.error || "Company intelligence failed.");
      return { key, salesNav: lead, prospect: { ...baseProspect, ...intel.patch } as Prospect, stage: "ready" };
    } catch (requestError) {
      return {
        key,
        salesNav: lead,
        stage: "error",
        error: requestError instanceof Error ? requestError.message : "Lead enrichment failed.",
      };
    }
  }

  async function extractAndEnrich() {
    if (!searchUrl.trim()) {
      setError("Paste a Sales Navigator People Search URL first.");
      return;
    }
    setExtracting(true);
    setError("");
    setNote("");
    setRows([]);
    setSelected(new Set());
    setProgress({ done: 0, total: 0 });

    try {
      const response = await fetch("/api/prospecting/salesnav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchUrl: searchUrl.trim(), limit: MAX_RESULTS }),
      });
      const payload = await response.json() as ExtractResponse;
      if (!response.ok || !payload.leads) throw new Error(payload.error || "Sales Navigator extraction failed.");

      const leads = payload.leads.slice(0, MAX_RESULTS);
      const initialRows = leads.map((lead) => ({
        key: lead.linkedinUrl || lead.salesLeadUrl || `${lead.name}:${lead.company}`,
        salesNav: lead,
        stage: normalizedDegree(lead.connectionDegree) === "1st" ? "skipped" as const : "enriching" as const,
        ...(normalizedDegree(lead.connectionDegree) === "1st" ? { error: "1st-degree connection — skipped before SignalHire." } : {}),
      }));
      setRows(initialRows);
      const eligible = leads.filter((lead) => normalizedDegree(lead.connectionDegree) !== "1st");
      setProgress({ done: 0, total: eligible.length });
      setNote(`Extracted ${leads.length} lead${leads.length === 1 ? "" : "s"} from ${payload.pagesRead || 1} page${payload.pagesRead === 1 ? "" : "s"}. Enriching non-1st-degree people with SignalHire + HubSpot intelligence.`);

      const pending = [...eligible];
      const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (pending.length) {
          const lead = pending.shift();
          if (!lead) return;
          const result = await enrichLead(lead);
          setRows((current) => current.map((row) => row.key === result.key ? result : row));
          setProgress((current) => ({ ...current, done: current.done + 1 }));
        }
      });
      await Promise.all(workers);
      setNote(`Finished. ${leads.length} extracted; SignalHire/HubSpot analysis completed for ${eligible.length}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sales Navigator extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  const counts = useMemo(() => {
    const enriched = rows.filter((row) => row.stage === "ready").length;
    return {
      extracted: rows.length,
      firstDegree: rows.filter(isFirstDegree).length,
      enriched,
      netNew: rows.filter(isNetNew).length,
      newPeople: rows.filter(isNewPerson).length,
      phone: rows.filter((row) => Boolean(row.prospect?.phone)).length,
      review: rows.filter((row) => row.stage === "error").length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "net-new" && !isNetNew(row)) return false;
      if (view === "new-people" && !isNewPerson(row)) return false;
      if (view === "review" && row.stage !== "error") return false;
      if (view === "all" && isFirstDegree(row)) return false;
      if (!term) return true;
      const prospect = row.prospect;
      return [row.salesNav.name, row.salesNav.title, row.salesNav.company, row.salesNav.location,
        prospect?.fullName, prospect?.title, prospect?.company, prospect?.email, prospect?.phone,
        prospect?.companyDomain, prospect?.detectedAts]
        .some((value) => String(value || "").toLowerCase().includes(term));
    }).sort((a, b) => (b.prospect?.score || 0) - (a.prospect?.score || 0));
  }, [query, rows, view]);

  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.key));
  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of visible) {
        if (allVisibleSelected) next.delete(row.key);
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
          <span className={styles.eyebrow}><Radar size={14}/>SALES NAV NET-NEW ENGINE</span>
          <h1>Search → SignalHire → HubSpot check</h1>
          <p>Extract a small Sales Navigator search batch, skip visible 1st-degree connections, enrich the rest, then surface the cleanest net-new accounts and people.</p>
        </div>
        <div className={styles.runtime}>
          <span data-ok={runtime?.sessionConfigured || false}><ShieldCheck size={13}/>{runtime?.sessionConfigured ? "LinkedIn session ready" : "LinkedIn session needed"}</span>
          <span data-ok={runtime?.signalHireConfigured || false}><Sparkles size={13}/>{runtime?.signalHireConfigured ? "SignalHire ready" : "SignalHire missing"}</span>
          <button type="button" className={styles.manageButton} onClick={() => setSessionPanelOpen((current) => !current)}><Settings2 size={13}/>{sessionPanelOpen ? "Close settings" : "LinkedIn session"}</button>
        </div>
      </header>

      <section className={styles.extractor}>
        <div className={styles.urlBox}>
          <label>Sales Navigator People Search URL</label>
          <div><input value={searchUrl} onChange={(event) => setSearchUrl(event.target.value)} placeholder="https://www.linkedin.com/sales/search/people?..."/><button type="button" onClick={() => void extractAndEnrich()} disabled={extracting || !runtime?.sessionConfigured || !runtime?.signalHireConfigured}>{extracting ? <><LoaderCircle className={styles.spin} size={16}/>Working {progress.total ? `${progress.done}/${progress.total}` : ""}</> : <><Radar size={16}/>Extract + Enrich 50</>}</button></div>
          <small>Bounded to two result pages / 50 leads. 1st-degree people are skipped before SignalHire enrichment.</small>
        </div>
      </section>

      {sessionPanelOpen && <section className={styles.sessionPanel}>
        <div className={styles.sessionHead}>
          <div><strong><ShieldCheck size={15}/>LinkedIn session settings</strong><span>Secrets are saved server-side only and are never shown back in the browser.</span></div>
          <small>{sessionStatus?.configured ? "Session configured" : "No session saved"}</small>
        </div>
        {!sessionStatus?.unlocked ? <div className={styles.unlockRow}>
          <label><KeyRound size={14}/><input type="password" value={setupKey} onChange={(event) => setSetupKey(event.target.value)} placeholder="Admin setup key" autoComplete="off"/></label>
          <button type="button" onClick={() => void unlockSessionSettings()} disabled={sessionBusy || !setupKey.trim()}>{sessionBusy ? <LoaderCircle className={styles.spin} size={14}/> : <KeyRound size={14}/>}Unlock</button>
        </div> : <div className={styles.sessionFields}>
          <label><span>li_at</span><input type="password" value={liAt} onChange={(event) => setLiAt(event.target.value)} placeholder="Paste li_at cookie value" autoComplete="off"/></label>
          <label><span>JSESSIONID <small>optional</small></span><input type="password" value={jsessionId} onChange={(event) => setJsessionId(event.target.value)} placeholder="Paste JSESSIONID" autoComplete="off"/></label>
          <button type="button" onClick={() => void saveSession()} disabled={sessionBusy || !liAt.trim()}>{sessionBusy ? <LoaderCircle className={styles.spin} size={14}/> : <Save size={14}/>}Save session</button>
        </div>}
        {sessionMessage && <div className={styles.sessionMessage}>{sessionMessage}</div>}
      </section>}

      {!runtime?.sessionConfigured && <div className={styles.warning}><CircleAlert size={15}/><div><strong>LinkedIn session setup is required.</strong><span>Click “LinkedIn session” above, unlock the settings once, then paste li_at and optional JSESSIONID directly here — no terminal needed.</span></div></div>}
      {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
      {note && <div className={styles.note}><CheckCircle2 size={15}/>{note}</div>}

      <section className={styles.metrics}>
        <article><UsersRound size={17}/><span>Extracted</span><strong>{counts.extracted}</strong></article>
        <article><Filter size={17}/><span>1st-degree skipped</span><strong>{counts.firstDegree}</strong></article>
        <article><Sparkles size={17}/><span>SignalHire enriched</span><strong>{counts.enriched}</strong></article>
        <article><Building2 size={17}/><span>Net-new companies</span><strong>{counts.netNew}</strong></article>
        <article><UserPlus size={17}/><span>New people @ existing</span><strong>{counts.newPeople}</strong></article>
        <article><Phone size={17}/><span>Phone found</span><strong>{counts.phone}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.views}>
          <button data-active={view === "net-new"} onClick={() => setView("net-new")}>✨ Net New <b>{counts.netNew}</b></button>
          <button data-active={view === "new-people"} onClick={() => setView("new-people")}>👤 New People <b>{counts.newPeople}</b></button>
          <button data-active={view === "all"} onClick={() => setView("all")}>All clean <b>{rows.length - counts.firstDegree}</b></button>
          <button data-active={view === "review"} onClick={() => setView("review")}>Needs review <b>{counts.review}</b></button>
        </div>
        <label className={styles.search}><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, person, phone, ATS…"/></label>
      </section>

      <section className={styles.selection}>
        <button type="button" onClick={selectVisible}>{allVisibleSelected ? "Unselect view" : "Select visible"}</button>
        <span><strong>{selected.size}</strong> selected</span>
        <small>Selection is ready for the next bulk HubSpot / outreach action; nothing is written automatically.</small>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}><div><h2>{view === "net-new" ? "Clean net-new queue" : view === "new-people" ? "New people at known companies" : view === "review" ? "Needs review" : "All clean prospects"}</h2><p>Sorted by the existing prospect score after SignalHire, ATS, hiring and HubSpot checks.</p></div><span>{visible.length} visible</span></div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th/><th>Score</th><th>Person</th><th>Company</th><th>Contact</th><th>HubSpot</th><th>ATS / Hiring</th><th>LinkedIn</th></tr></thead>
            <tbody>
              {visible.map((row) => {
                const prospect = row.prospect;
                return <tr key={row.key} data-selected={selected.has(row.key)}>
                  <td><input type="checkbox" checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}/></td>
                  <td><strong className={styles.score}>{prospect?.score ?? "—"}</strong><span>{prospect?.priority || row.stage}</span></td>
                  <td><strong>{prospect?.fullName || row.salesNav.name || "Unknown"}</strong><span>{prospect?.title || row.salesNav.title || "—"}</span><small>{prospect?.location || row.salesNav.location || "—"}</small></td>
                  <td><strong>{prospect?.company || row.salesNav.company || "—"}</strong><span>{prospect?.companyDomain || ""}</span><small>{companyStatus(row)}</small></td>
                  <td>{prospect?.phone ? <strong className={styles.phone}><Phone size={12}/>{prospect.phone}</strong> : <span className={styles.muted}>No phone</span>}{prospect?.email ? <span><Mail size={11}/>{prospect.email}</span> : <small>{contactability(row)}</small>}</td>
                  <td><span className={row.stage === "ready" && !prospect?.hubspot.inHubSpot ? styles.good : styles.badge}>{companyStatus(row)}</span><small className={row.stage === "ready" && !prospect?.hubspotContact?.inHubSpot ? styles.goodText : ""}>{personStatus(row)}</small>{row.error && <small className={styles.rowError}>{row.error}</small>}</td>
                  <td>{prospect?.detectedAts ? <strong>{prospect.detectedAts}</strong> : <strong className={styles.noAts}>No ATS detected</strong>}<span>{prospect?.hiring?.status || (row.stage === "ready" ? "Unknown" : "Checking")}{prospect?.hiring?.activeJobs ? ` · ${prospect.hiring.activeJobs} jobs` : ""}</span></td>
                  <td><span>{row.salesNav.connectionDegree || "Degree unknown"}</span>{row.salesNav.salesLeadUrl && <a href={row.salesNav.salesLeadUrl} target="_blank" rel="noreferrer">Sales Nav<ExternalLink size={11}/></a>}{row.salesNav.linkedinUrl && <a href={row.salesNav.linkedinUrl} target="_blank" rel="noreferrer">Profile<ExternalLink size={11}/></a>}</td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={8} className={styles.empty}>{rows.length ? "No prospects match this view yet." : "Paste a Sales Navigator search URL to build the net-new queue."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>;
}
