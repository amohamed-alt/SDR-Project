"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Building2, CheckCircle2, CircleAlert, ExternalLink, Filter, LoaderCircle,
  Mail, Phone, RefreshCw, Send, ShieldCheck, Sparkles, UserCheck, UserPlus, UsersRound,
} from "lucide-react";
import styles from "./SignalHireQueue.module.css";

type SignalHireLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  linkedinUrl: string;
  signalHireProfileUrl: string;
  email: string;
  emails: string[];
  phone: string;
  phones: string[];
  rawText?: string;
};

type SignalHireBatch = {
  id: string;
  importedAt: string;
  sourceUrl: string;
  listName: string;
  leads: SignalHireLead[];
};

type CompanionStatus = {
  ok: boolean;
  paired: boolean;
  signalHireConfigured: boolean;
  latestBatch?: SignalHireBatch | null;
};

type HubSpotContactCheck = {
  inHubSpot: boolean;
  id: string;
  matchedBy: string;
  properties?: Record<string, unknown>;
};

type HubSpotCompanyCheck = {
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
  protected: boolean;
  protectedReason: string;
};

type Precheck = { contact: HubSpotContactCheck; company: HubSpotCompanyCheck; checkedAt: string };

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

type Stage = "checking" | "existing" | "protected" | "enriching" | "ready" | "error";
type PushState = { loading?: boolean; success?: string; error?: string };
type Row = { key: string; lead: SignalHireLead; stage: Stage; precheck?: Precheck; prospect?: Prospect; error?: string };
type View = "new" | "existing" | "protected" | "all" | "review";

function keyFor(lead: SignalHireLead) {
  return lead.linkedinUrl || lead.email || lead.signalHireProfileUrl || `${lead.name}:${lead.company}`;
}

function isEligible(row: Row) {
  return row.stage === "ready" && Boolean(row.prospect) && !row.precheck?.contact.inHubSpot && !row.precheck?.company.protected;
}

function companyState(company?: HubSpotCompanyCheck) {
  if (!company) return "Checking company";
  if (!company.inHubSpot) return "New company";
  const parts = [company.accountType, company.accountStatus].filter(Boolean);
  if (company.openDeals) parts.push(`${company.openDeals} open deal${company.openDeals === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "Existing company";
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

export function SignalHireQueue() {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("new");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushState, setPushState] = useState<Record<string, PushState>>({});
  const [bulk, setBulk] = useState({ loading: false, done: 0, total: 0 });
  const lastBatch = useRef("");
  const processingRef = useRef(false);

  async function fetchStatus() {
    const response = await fetch("/api/prospecting/signalhire/companion", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not read SignalHire queue status.");
    return readJson<CompanionStatus>(response);
  }

  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const payload = await fetchStatus();
        if (!active) return;
        setStatus(payload);
        const batch = payload.latestBatch;
        if (batch?.id && batch.id !== lastBatch.current && !processingRef.current) {
          lastBatch.current = batch.id;
          void processBatch(batch);
        }
      } catch {
        if (active) setStatus({ ok: false, paired: false, signalHireConfigured: false });
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function precheckLead(lead: SignalHireLead) {
    const response = await fetch("/api/prospecting/signalhire/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    });
    const payload = await readJson<Precheck & { error?: string }>(response);
    if (!response.ok) throw new Error(payload.error || "HubSpot precheck failed.");
    return payload;
  }

  async function enrichLead(lead: SignalHireLead, precheck: Precheck) {
    const source = `SignalHire Lead List · ${status?.latestBatch?.listName || "Abdullah"}`;
    const fastResponse = await fetch("/api/prospecting/resolve-companion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        linkedinUrl: lead.linkedinUrl,
        name: lead.name,
        company: lead.company,
        title: lead.title,
        location: lead.location,
        source,
      }),
    });
    const fast = await readJson<{ prospect?: Prospect; error?: string }>(fastResponse);
    if (!fastResponse.ok || !fast.prospect) throw new Error(fast.error || "SignalHire could not enrich this lead.");

    const intelResponse = await fetch("/api/prospecting/intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        linkedinUrl: fast.prospect.linkedinUrl,
        company: fast.prospect.company,
        companyWebsite: fast.prospect.companyWebsite,
        companyDomain: fast.prospect.companyDomain,
        email: fast.prospect.email,
        emails: fast.prospect.emails,
        score: fast.prospect.score,
        scoreReasons: fast.prospect.scoreReasons,
      }),
    });
    const intel = await readJson<{ patch?: Partial<Prospect>; error?: string }>(intelResponse);
    if (!intelResponse.ok || !intel.patch) throw new Error(intel.error || "Company intelligence failed.");
    return { ...fast.prospect, ...intel.patch, source } as Prospect;
  }

  async function processOne(lead: SignalHireLead): Promise<Row> {
    const key = keyFor(lead);
    try {
      const precheck = await precheckLead(lead);
      if (precheck.contact.inHubSpot) return { key, lead, precheck, stage: "existing" };
      if (precheck.company.protected) return { key, lead, precheck, stage: "protected" };
      const prospect = await enrichLead(lead, precheck);
      return { key, lead, precheck, prospect, stage: "ready" };
    } catch (requestError) {
      return { key, lead, stage: "error", error: requestError instanceof Error ? requestError.message : "Lead processing failed." };
    }
  }

  async function processBatch(batch: SignalHireBatch) {
    processingRef.current = true;
    setProcessing(true);
    setError("");
    setSelected(new Set());
    setPushState({});
    setRows(batch.leads.map((lead) => ({ key: keyFor(lead), lead, stage: "checking" })));
    setProgress({ done: 0, total: batch.leads.length });
    setNote(`SignalHire list “${batch.listName}” synced with ${batch.leads.length} lead${batch.leads.length === 1 ? "" : "s"}. Checking HubSpot before spending enrichment credits.`);

    const pending = [...batch.leads];
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length) {
        const lead = pending.shift();
        if (!lead) return;
        const key = keyFor(lead);
        setRows((current) => current.map((row) => row.key === key ? { ...row, stage: "checking" } : row));
        let checked: Precheck | undefined;
        try {
          checked = await precheckLead(lead);
          if (checked.contact.inHubSpot) {
            setRows((current) => current.map((row) => row.key === key ? { key, lead, precheck: checked, stage: "existing" } : row));
          } else if (checked.company.protected) {
            setRows((current) => current.map((row) => row.key === key ? { key, lead, precheck: checked, stage: "protected" } : row));
          } else {
            setRows((current) => current.map((row) => row.key === key ? { key, lead, precheck: checked, stage: "enriching" } : row));
            const prospect = await enrichLead(lead, checked);
            setRows((current) => current.map((row) => row.key === key ? { key, lead, precheck: checked, prospect, stage: "ready" } : row));
          }
        } catch (requestError) {
          setRows((current) => current.map((row) => row.key === key ? {
            key, lead, precheck: checked, stage: "error",
            error: requestError instanceof Error ? requestError.message : "Lead processing failed.",
          } : row));
        } finally {
          setProgress((current) => ({ ...current, done: current.done + 1 }));
        }
      }
    });

    try {
      await Promise.all(workers);
      setNote(`Finished “${batch.listName}”. Existing HubSpot contacts and protected accounts were stopped before SignalHire enrichment.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SignalHire queue failed.");
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }

  async function push(row: Row) {
    if (!row.prospect || !isEligible(row)) return false;
    setPushState((current) => ({ ...current, [row.key]: { loading: true } }));
    try {
      const response = await fetch("/api/prospecting/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row.prospect),
      });
      const payload = await readJson<{
        duplicate?: boolean; taskId?: string; contactId?: string; companyId?: string; ownerName?: string; error?: string;
      }>(response);
      if (!response.ok) throw new Error(payload.error || "HubSpot push failed.");
      const success = payload.duplicate
        ? `Already queued · Task ${payload.taskId || "exists"}`
        : `Pushed · ${payload.ownerName || "HubSpot owner"} · Task ${payload.taskId || "created"}`;
      setPushState((current) => ({ ...current, [row.key]: { success } }));
      return true;
    } catch (requestError) {
      setPushState((current) => ({ ...current, [row.key]: { error: requestError instanceof Error ? requestError.message : "Push failed." } }));
      return false;
    }
  }

  async function pushSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && isEligible(row) && !pushState[row.key]?.success);
    if (!queue.length) return;
    setBulk({ loading: true, done: 0, total: queue.length });
    const pending = [...queue];
    const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
      while (pending.length) {
        const row = pending.shift();
        if (!row) return;
        await push(row);
        setBulk((current) => ({ ...current, done: current.done + 1 }));
      }
    });
    await Promise.all(workers);
    setBulk((current) => ({ ...current, loading: false }));
  }

  const counts = useMemo(() => ({
    total: rows.length,
    new: rows.filter((row) => row.stage === "ready").length,
    existing: rows.filter((row) => row.stage === "existing").length,
    protected: rows.filter((row) => row.stage === "protected").length,
    existingCompanies: rows.filter((row) => row.precheck?.company.inHubSpot).length,
    phones: rows.filter((row) => Boolean(row.prospect?.phone || row.lead.phone)).length,
    review: rows.filter((row) => row.stage === "error").length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "new" && row.stage !== "ready") return false;
      if (view === "existing" && row.stage !== "existing") return false;
      if (view === "protected" && row.stage !== "protected") return false;
      if (view === "review" && row.stage !== "error") return false;
      if (view === "all" && row.stage === "checking") return true;
      if (!term) return true;
      const p = row.prospect;
      const c = row.precheck?.company;
      return [row.lead.name, row.lead.title, row.lead.company, row.lead.email, row.lead.phone,
        p?.fullName, p?.companyDomain, p?.detectedAts, c?.accountType, c?.accountStatus, c?.detectedAts]
        .some((value) => String(value || "").toLowerCase().includes(term));
    }).sort((a, b) => (b.prospect?.score || 0) - (a.prospect?.score || 0));
  }, [query, rows, view]);

  const selectedEligible = rows.filter((row) => selected.has(row.key) && isEligible(row)).length;
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.key));

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of visible) {
        if (!isEligible(row)) continue;
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
          <span className={styles.eyebrow}><Sparkles size={14}/>SIGNALHIRE → HUBSPOT QUEUE</span>
          <h1>SignalHire list → HubSpot check → Push + Task</h1>
          <p>Add leads to <b>{status?.latestBatch?.listName || "Abdullah"}</b> in SignalHire, click the existing Talentera Companion once, and this workspace checks HubSpot before enrichment or writes.</p>
        </div>
        <div className={styles.runtime}>
          <span data-ok={status?.paired || false}><ShieldCheck size={13}/>{status?.paired ? "Companion paired" : "Pairing required"}</span>
          <span data-ok={status?.signalHireConfigured || false}><Sparkles size={13}/>{status?.signalHireConfigured ? "SignalHire API ready" : "SignalHire API missing"}</span>
        </div>
      </header>

      <section className={styles.syncCard}>
        <div>
          <strong><RefreshCw size={16}/>Sync list “{status?.latestBatch?.listName || "Abdullah"}”</strong>
          <span>Open the SignalHire Lead List → click Talentera Prospecting Companion → <b>Sync current SignalHire list</b>.</span>
          <small>The browser only reads the page after your click. Existing contacts and protected customers are checked in HubSpot first, so they do not burn another SignalHire enrichment call.</small>
        </div>
        {status?.latestBatch?.sourceUrl && <a href={status.latestBatch.sourceUrl} target="_blank" rel="noreferrer">Open source list <ExternalLink size={12}/></a>}
      </section>

      {processing && <div className={styles.notice}><LoaderCircle className={styles.spin} size={15}/>Checking {progress.done}/{progress.total} · HubSpot first, SignalHire only for clean new leads…</div>}
      {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
      {note && !processing && <div className={styles.notice}><CheckCircle2 size={15}/>{note}</div>}

      <section className={styles.metrics}>
        <article><UsersRound size={17}/><span>In list</span><strong>{counts.total}</strong></article>
        <article><UserPlus size={17}/><span>Clean new</span><strong>{counts.new}</strong></article>
        <article><UserCheck size={17}/><span>Contact exists</span><strong>{counts.existing}</strong></article>
        <article><Building2 size={17}/><span>Company exists</span><strong>{counts.existingCompanies}</strong></article>
        <article><ShieldCheck size={17}/><span>Protected</span><strong>{counts.protected}</strong></article>
        <article><Phone size={17}/><span>Phone ready</span><strong>{counts.phones}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.views}>
          <button data-active={view === "new"} onClick={() => setView("new")}>✨ New <b>{counts.new}</b></button>
          <button data-active={view === "existing"} onClick={() => setView("existing")}>Existing contacts <b>{counts.existing}</b></button>
          <button data-active={view === "protected"} onClick={() => setView("protected")}>Protected <b>{counts.protected}</b></button>
          <button data-active={view === "all"} onClick={() => setView("all")}>All <b>{counts.total}</b></button>
          <button data-active={view === "review"} onClick={() => setView("review")}>Review <b>{counts.review}</b></button>
        </div>
        <label className={styles.search}><Filter size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, company, status, ATS…"/></label>
      </section>

      <section className={styles.selection}>
        <button type="button" onClick={selectVisible}>{allVisibleSelected ? "Unselect eligible" : "Select eligible"}</button>
        <span><strong>{selectedEligible}</strong> eligible selected</span>
        <button className={styles.pushSelected} type="button" onClick={() => void pushSelected()} disabled={!selectedEligible || bulk.loading}>
          {bulk.loading ? <LoaderCircle className={styles.spin} size={14}/> : <Send size={14}/>}
          {bulk.loading ? `Pushing ${bulk.done}/${bulk.total}` : "Push selected + Tasks"}
        </button>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}>
          <div><h2>{status?.latestBatch?.listName || "Abdullah"} queue</h2><p>HubSpot contact + company status, then SignalHire enrichment, ATS/hiring intelligence and reviewed push.</p></div>
          <span>{visible.length} visible</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th/><th>Lead</th><th>Contact</th><th>Company / HubSpot</th><th>ATS / Hiring</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {visible.map((row) => {
                const prospect = row.prospect;
                const company = row.precheck?.company;
                const contactExists = row.precheck?.contact.inHubSpot;
                const push = pushState[row.key];
                return <tr key={row.key} data-protected={row.stage === "protected"}>
                  <td><input type="checkbox" disabled={!isEligible(row)} checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}/></td>
                  <td>
                    <strong>{prospect?.fullName || row.lead.name}</strong>
                    <span>{prospect?.title || row.lead.title || "—"}</span>
                    <small>{prospect?.location || row.lead.location || "—"}</small>
                    <div className={styles.links}>{row.lead.signalHireProfileUrl && <a href={row.lead.signalHireProfileUrl} target="_blank" rel="noreferrer">SignalHire <ExternalLink size={10}/></a>}{prospect?.linkedinUrl && <a href={prospect.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={10}/></a>}</div>
                  </td>
                  <td>
                    {(prospect?.phone || row.lead.phone) ? <strong className={styles.phone}><Phone size={12}/>{prospect?.phone || row.lead.phone}</strong> : <span className={styles.muted}>No phone yet</span>}
                    {(prospect?.email || row.lead.email) ? <span><Mail size={11}/>{prospect?.email || row.lead.email}</span> : <small>No email yet</small>}
                    <small className={contactExists ? styles.badText : styles.goodText}>{contactExists ? `Existing contact · ${row.precheck?.contact.matchedBy}` : row.precheck ? "New contact" : "Checking…"}</small>
                  </td>
                  <td>
                    <strong>{prospect?.company || company?.name || row.lead.company || "—"}</strong>
                    <span>{prospect?.companyDomain || company?.domain || ""}</span>
                    <small className={company?.protected ? styles.badText : company?.inHubSpot ? styles.warnText : styles.goodText}>{companyState(company)}</small>
                    {company?.searchStatus && <small>Search: {company.searchStatus}</small>}
                  </td>
                  <td>
                    <strong>{prospect?.detectedAts || company?.detectedAts || "No ATS detected"}</strong>
                    <span>{prospect?.hiring?.status || (company?.inHubSpot ? "HubSpot data" : row.stage === "ready" ? "Unknown" : "Pending")}{prospect?.hiring?.activeJobs ? ` · ${prospect.hiring.activeJobs} jobs` : ""}</span>
                    {company?.careerPageUrl && <a href={company.careerPageUrl} target="_blank" rel="noreferrer">Career page <ExternalLink size={10}/></a>}
                  </td>
                  <td>
                    {row.stage === "checking" && <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>HubSpot check</span>}
                    {row.stage === "enriching" && <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>Enriching</span>}
                    {row.stage === "ready" && <span className={styles.goodBadge}><CheckCircle2 size={11}/>Ready to push</span>}
                    {row.stage === "existing" && <span className={styles.existingBadge}><UserCheck size={11}/>Already in HubSpot</span>}
                    {row.stage === "protected" && <span className={styles.protectedBadge}><ShieldCheck size={11}/>{company?.protectedReason || "Protected"}</span>}
                    {row.stage === "error" && <span className={styles.errorBadge}><CircleAlert size={11}/>Needs review</span>}
                    {row.error && <small className={styles.rowError}>{row.error}</small>}
                    {push?.success && <small className={styles.goodText}>{push.success}</small>}
                    {push?.error && <small className={styles.badText}>{push.error}</small>}
                  </td>
                  <td>
                    <button className={styles.pushButton} type="button" disabled={!isEligible(row) || Boolean(push?.loading || push?.success)} onClick={() => void push(row)}>
                      {push?.loading ? <LoaderCircle className={styles.spin} size={13}/> : <Send size={13}/>}
                      {push?.success ? "Pushed" : "Push + Task"}
                    </button>
                  </td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={7} className={styles.empty}>{rows.length ? "No leads match this view." : "Sync the SignalHire list from the Talentera Companion to start."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>;
}
