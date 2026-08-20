"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Building2, CheckCircle2, CircleAlert, ExternalLink, Filter, KeyRound,
  LoaderCircle, Mail, Phone, Radar, Search, ShieldCheck, Sparkles, UserPlus, UsersRound,
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
  stage: "enriching" | "ready" | "error" | "skipped";
  error?: string;
};

type CompanionBatch = {
  id: string;
  importedAt: string;
  sourceUrl: string;
  pagesRead: number;
  leads: SalesNavLead[];
};

type CompanionStatus = {
  ok: boolean;
  paired: boolean;
  unlocked: boolean;
  signalHireConfigured: boolean;
  createdAt?: string;
  lastUsedAt?: string;
  latestBatch?: CompanionBatch | null;
};

type ResolveResponse = { prospect?: Prospect; error?: string };
type IntelligenceResponse = { patch?: Partial<Prospect>; error?: string };
type View = "net-new" | "new-people" | "all" | "review";

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

function companyStatus(row: Row) {
  if (row.stage !== "ready") return "Checking";
  return row.prospect?.hubspot.inHubSpot ? "Existing company" : "New company";
}

function personStatus(row: Row) {
  if (isFirstDegree(row)) return "1st-degree";
  if (row.stage !== "ready") return "Checking";
  return row.prospect?.hubspotContact?.inHubSpot ? "Existing contact" : "New person";
}

export function SalesNavCompanionProspecting() {
  const [companion, setCompanion] = useState<CompanionStatus | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [view, setView] = useState<View>("net-new");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [setupKey, setSetupKey] = useState("");
  const [pairToken, setPairToken] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const lastBatchId = useRef("");
  const processingRef = useRef(false);

  async function fetchCompanionStatus() {
    const response = await fetch("/api/prospecting/salesnav/companion", { cache: "no-store" });
    return response.json() as Promise<CompanionStatus>;
  }

  useEffect(() => {
    let active = true;
    const read = () => {
      void fetch("/api/prospecting/salesnav/companion", { cache: "no-store" })
        .then((response) => response.json() as Promise<CompanionStatus>)
        .then((payload) => {
          if (!active) return;
          setCompanion(payload);
          const batch = payload.latestBatch;
          if (batch?.id && batch.id !== lastBatchId.current && !processingRef.current) {
            lastBatchId.current = batch.id;
            void processImportedBatch(batch);
          }
        })
        .catch(() => {
          if (active) setCompanion({ ok: false, paired: false, unlocked: false, signalHireConfigured: false });
        });
    };
    read();
    const timer = window.setInterval(read, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function unlockSettings() {
    if (!setupKey.trim()) return;
    setSettingsBusy(true);
    setSettingsMessage("");
    try {
      const response = await fetch("/api/prospecting/salesnav/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", setupKey: setupKey.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not unlock companion settings.");
      setSetupKey("");
      setSettingsMessage("Admin settings unlocked on this browser.");
      setCompanion(await fetchCompanionStatus());
    } catch (requestError) {
      setSettingsMessage(requestError instanceof Error ? requestError.message : "Could not unlock companion settings.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function generateToken() {
    setSettingsBusy(true);
    setSettingsMessage("");
    try {
      const response = await fetch("/api/prospecting/salesnav/companion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_token" }),
      });
      const payload = await response.json() as { token?: string; error?: string; oldVpsSessionCleared?: boolean };
      if (!response.ok || !payload.token) throw new Error(payload.error || "Could not generate pairing token.");
      setPairToken(payload.token);
      setSettingsMessage(payload.oldVpsSessionCleared
        ? "New Chrome pairing token created. The old VPS LinkedIn session was deleted for safety."
        : "New Chrome pairing token created.");
      setCompanion(await fetchCompanionStatus());
    } catch (requestError) {
      setSettingsMessage(requestError instanceof Error ? requestError.message : "Could not generate pairing token.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function enrichLead(lead: SalesNavLead): Promise<Row> {
    const key = lead.linkedinUrl || lead.salesLeadUrl || `${lead.name}:${lead.company}`;
    if (isFirstDegree({ key, salesNav: lead, stage: "skipped" })) {
      return { key, salesNav: lead, stage: "skipped", error: "1st-degree connection — skipped before SignalHire." };
    }
    try {
      const fastResponse = await fetch("/api/prospecting/resolve-companion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedinUrl: lead.linkedinUrl || "",
          name: lead.name,
          company: lead.company,
          title: lead.title,
          location: lead.location,
          source: "Sales Nav Chrome Companion",
        }),
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
      return { key, salesNav: lead, stage: "error", error: requestError instanceof Error ? requestError.message : "Lead enrichment failed." };
    }
  }

  async function processImportedBatch(batch: CompanionBatch) {
    processingRef.current = true;
    setProcessing(true);
    setError("");
    setSelected(new Set());
    const initial = batch.leads.map((lead) => ({
      key: lead.linkedinUrl || lead.salesLeadUrl || `${lead.name}:${lead.company}`,
      salesNav: lead,
      stage: normalizedDegree(lead.connectionDegree) === "1st" ? "skipped" as const : "enriching" as const,
    }));
    setRows(initial);
    const eligible = batch.leads.filter((lead) => normalizedDegree(lead.connectionDegree) !== "1st");
    setProgress({ done: 0, total: eligible.length });
    setNote(`Chrome Companion imported ${eligible.length} clean lead${eligible.length === 1 ? "" : "s"} from ${batch.pagesRead} Sales Nav page${batch.pagesRead === 1 ? "" : "s"}. Running SignalHire + HubSpot + ATS intelligence.`);

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
    try {
      await Promise.all(workers);
      setNote(`Finished companion batch. SignalHire/HubSpot analysis completed for ${eligible.length} lead${eligible.length === 1 ? "" : "s"}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Companion batch failed.");
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }

  const counts = useMemo(() => ({
    extracted: rows.length,
    firstDegree: rows.filter(isFirstDegree).length,
    enriched: rows.filter((row) => row.stage === "ready").length,
    netNew: rows.filter(isNetNew).length,
    newPeople: rows.filter(isNewPerson).length,
    phone: rows.filter((row) => Boolean(row.prospect?.phone)).length,
    review: rows.filter((row) => row.stage === "error").length,
  }), [rows]);

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
          <span className={styles.eyebrow}><Radar size={14}/>SALES NAV CHROME COMPANION</span>
          <h1>Chrome → SignalHire → HubSpot check</h1>
          <p>Sales Navigator stays inside your normal Chrome session. The companion sends only the lead fields you explicitly extract — never LinkedIn cookies or passwords.</p>
        </div>
        <div className={styles.runtime}>
          <span data-ok={companion?.paired || false}><ShieldCheck size={13}/>{companion?.paired ? "Chrome Companion paired" : "Companion not paired"}</span>
          <span data-ok={companion?.signalHireConfigured || false}><Sparkles size={13}/>{companion?.signalHireConfigured ? "SignalHire ready" : "SignalHire missing"}</span>
          <button type="button" className={styles.manageButton} onClick={() => setSettingsOpen((current) => !current)}><KeyRound size={13}/>{settingsOpen ? "Close setup" : "Companion setup"}</button>
        </div>
      </header>

      <section className={styles.extractor}>
        <div className={styles.urlBox}>
          <label>SAFE WORKFLOW</label>
          <div>
            <input readOnly value="Open Sales Navigator People Search → click Talentera Sales Nav Companion → Extract up to 50" />
            <a className={styles.manageButton} href="https://github.com/amohamed-alt/SDR-Project/tree/main/chrome-companion" target="_blank" rel="noreferrer">Companion files <ExternalLink size={12}/></a>
          </div>
          <small>No LinkedIn cookie permission. No headless LinkedIn login. No background crawling. Max 50 people / two pages per user-triggered run.</small>
        </div>
      </section>

      {settingsOpen && <section className={styles.sessionPanel}>
        <div className={styles.sessionHead}>
          <div><strong><ShieldCheck size={15}/>Chrome Companion pairing</strong><span>The server stores only a SHA-256 hash of the pairing token. The extension stores the token locally in Chrome.</span></div>
          <small>{companion?.paired ? "Pairing active" : "Pairing required"}</small>
        </div>
        {!companion?.unlocked ? <div className={styles.unlockRow}>
          <label><KeyRound size={14}/><input type="password" value={setupKey} onChange={(event) => setSetupKey(event.target.value)} placeholder="Admin setup key" autoComplete="off"/></label>
          <button type="button" onClick={() => void unlockSettings()} disabled={settingsBusy || !setupKey.trim()}>{settingsBusy ? <LoaderCircle className={styles.spin} size={14}/> : <KeyRound size={14}/>}Unlock</button>
        </div> : <div className={styles.sessionFields}>
          <label><span>One-time pairing token</span><input readOnly value={pairToken} placeholder="Generate a token, then paste it into the Chrome Companion" /></label>
          <button type="button" onClick={() => void generateToken()} disabled={settingsBusy}>{settingsBusy ? <LoaderCircle className={styles.spin} size={14}/> : <ShieldCheck size={14}/>}Generate / rotate token</button>
          <button type="button" onClick={() => pairToken && void navigator.clipboard.writeText(pairToken)} disabled={!pairToken}>Copy token</button>
        </div>}
        <div className={styles.sessionMessage}>1) Load the <b>chrome-companion</b> folder as an unpacked Chrome extension. 2) Generate a token here. 3) Paste it into the extension and press Test connection. 4) Open a Sales Nav People Search and extract 25 or 50.</div>
        {settingsMessage && <div className={styles.sessionMessage}>{settingsMessage}</div>}
      </section>}

      {!companion?.unlocked && <div className={styles.warning}><CircleAlert size={15}/><div><strong>Unlock Companion setup once on this browser.</strong><span>This is only for pairing and reading imported batches. LinkedIn credentials are no longer stored on the VPS.</span></div></div>}
      {processing && <div className={styles.note}><LoaderCircle className={styles.spin} size={15}/>Enriching {progress.done}/{progress.total} with SignalHire + HubSpot intelligence…</div>}
      {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
      {note && !processing && <div className={styles.note}><CheckCircle2 size={15}/>{note}</div>}

      <section className={styles.metrics}>
        <article><UsersRound size={17}/><span>Imported</span><strong>{counts.extracted}</strong></article>
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
        <small>Nothing is written to HubSpot automatically. Selection is reserved for the next reviewed bulk action.</small>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}><div><h2>{view === "net-new" ? "Clean net-new queue" : view === "new-people" ? "New people at known companies" : view === "review" ? "Needs review" : "All clean prospects"}</h2><p>Sorted after SignalHire enrichment, HubSpot dedupe, ATS and hiring checks.</p></div><span>{visible.length} visible</span></div>
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
                  <td>{prospect?.phone ? <strong className={styles.phone}><Phone size={12}/>{prospect.phone}</strong> : <span className={styles.muted}>No phone</span>}{prospect?.email ? <span><Mail size={11}/>{prospect.email}</span> : <small>No email</small>}</td>
                  <td><span className={row.stage === "ready" && !prospect?.hubspot.inHubSpot ? styles.good : styles.badge}>{companyStatus(row)}</span><small className={row.stage === "ready" && !prospect?.hubspotContact?.inHubSpot ? styles.goodText : ""}>{personStatus(row)}</small>{row.error && <small className={styles.rowError}>{row.error}</small>}</td>
                  <td>{prospect?.detectedAts ? <strong>{prospect.detectedAts}</strong> : <strong className={styles.noAts}>No ATS detected</strong>}<span>{prospect?.hiring?.status || (row.stage === "ready" ? "Unknown" : "Checking")}{prospect?.hiring?.activeJobs ? ` · ${prospect.hiring.activeJobs} jobs` : ""}</span></td>
                  <td><span>{row.salesNav.connectionDegree || "Degree unknown"}</span>{row.salesNav.salesLeadUrl && <a href={row.salesNav.salesLeadUrl} target="_blank" rel="noreferrer">Sales Nav<ExternalLink size={11}/></a>}{prospect?.linkedinUrl && <a href={prospect.linkedinUrl} target="_blank" rel="noreferrer">Profile<ExternalLink size={11}/></a>}</td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={8} className={styles.empty}>{rows.length ? "No prospects match this view yet." : "Pair the Chrome Companion, then extract a Sales Navigator People Search batch."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>;
}
