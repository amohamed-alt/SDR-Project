"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileSpreadsheet,
  LoaderCircle,
  PhoneCall,
  Send,
  ShieldCheck,
  Upload,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { parseSignalHireCsv, type SignalHireCsvLead } from "@/lib/signalhire-csv";
import styles from "./LeadImportPushV2.module.css";

type ContactCheck = { inHubSpot: boolean; id: string; matchedBy: string };
type CompanyCheck = {
  inHubSpot: boolean;
  id: string;
  matchedBy: string;
  name: string;
  domain: string;
  accountType: string;
  accountStatus: string;
  openDeals: number;
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
type Stage = "checking" | "ready" | "existing" | "engaged" | "retention" | "protected" | "error" | "pushed";
type View = "ready" | "existing" | "engaged" | "retention" | "protected" | "pushed" | "review" | "all";
type Owner = { id: string; name: string };
type TriggerKey = "job_change" | "promoted" | "linkedin_active" | "frequent_posts" | "hiring_now" | "hr_growth" | "ats_change" | "senior_buyer";

type Row = {
  key: string;
  lead: SignalHireCsvLead;
  stage: Stage;
  precheck?: Precheck;
  triggers: TriggerKey[];
  error?: string;
  push?: { loading?: boolean; success?: string; error?: string; taskId?: string };
};

const TRIGGERS: Array<{ key: TriggerKey; label: string }> = [
  { key: "job_change", label: "Changed job / joined recently" },
  { key: "promoted", label: "Recently promoted" },
  { key: "linkedin_active", label: "Active on LinkedIn" },
  { key: "frequent_posts", label: "Posts frequently on LinkedIn" },
  { key: "hiring_now", label: "Company is hiring now" },
  { key: "hr_growth", label: "HR / recruiting team is growing" },
  { key: "ats_change", label: "ATS / process change signal" },
  { key: "senior_buyer", label: "Senior HR decision-maker" },
];

const VIEW_LABELS: Record<View, string> = {
  ready: "Ready",
  existing: "Existing person",
  engaged: "Engaged company",
  retention: "Retention",
  protected: "Protected",
  pushed: "Pushed",
  review: "Review",
  all: "All",
};

function keyFor(lead: SignalHireCsvLead, index: number) {
  return lead.id || lead.linkedinUrl || lead.email || lead.phone || `${lead.name}:${lead.company}:${index}`;
}

function isRetention(company?: CompanyCheck) {
  return String(company?.accountType || "").trim().toLowerCase() === "retention";
}

function stageFromCheck(check: Precheck): Stage {
  if (isRetention(check.company)) return "retention";
  if (check.contact.inHubSpot) return "existing";
  if (check.company.protected) return "protected";
  if (check.company.engaged) return "engaged";
  return "ready";
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function scoreLead(lead: SignalHireCsvLead) {
  const reasons: Array<{ label: string; points: number }> = [];
  if (lead.businessEmails.length) reasons.push({ label: "Business email available", points: 20 });
  else if (lead.personalEmails.length) reasons.push({ label: "Personal email available", points: 10 });
  if (lead.phones.length) reasons.push({ label: "Phone number available", points: 20 });
  if (lead.linkedinUrl) reasons.push({ label: "LinkedIn profile available", points: 10 });
  if (lead.companyDomain) reasons.push({ label: "Company domain available", points: 10 });
  if (/\b(chief|vp|vice president|director|head|general manager)\b/i.test(lead.title)) reasons.push({ label: "Senior decision-maker title", points: 15 });
  const score = Math.min(100, 25 + reasons.reduce((sum, item) => sum + item.points, 0));
  return { score, priority: score >= 75 ? "high" as const : score >= 55 ? "medium" as const : "normal" as const, reasons };
}

function prospectPayload(row: Row, fileName: string) {
  const scored = scoreLead(row.lead);
  return {
    ...row.lead,
    linkedinUrl: row.lead.linkedinUrl,
    source: `SignalHire CSV · ${fileName}`.slice(0, 120),
    signalHireUid: row.lead.id.slice(0, 160),
    fullName: row.lead.name,
    title: row.lead.title,
    company: row.lead.company,
    companyWebsite: row.lead.companyWebsite,
    companyDomain: row.lead.companyDomain || row.precheck?.company.domain || "",
    location: row.lead.location,
    email: row.lead.email,
    emails: row.lead.emails,
    phone: row.lead.phone,
    phones: row.lead.phones,
    score: scored.score,
    priority: scored.priority,
    previousTitle: row.lead.previousTitle,
    previousCompany: row.lead.previousCompany,
    scoreReasons: scored.reasons,
  };
}

async function precheckLead(lead: SignalHireCsvLead) {
  const response = await fetch("/api/prospecting/signalhire/precheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lead),
  });
  const payload = await response.json() as Precheck & { error?: string };
  if (!response.ok) throw new Error(payload.error || "HubSpot precheck failed.");
  return payload;
}

export function LeadImportPushV2() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<View>("ready");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [bulk, setBulk] = useState({ loading: false, done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/prospecting/task-owners", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { owners?: Owner[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load task owners.");
        setOwners(payload.owners || []);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Could not load task owners."));
  }, []);

  async function processFile(file: File) {
    setProcessing(true);
    setError("");
    setMessage("");
    setSelected(new Set());
    setFileName(file.name);
    try {
      const parsed = parseSignalHireCsv(await file.text());
      const initial: Row[] = parsed.leads.map((lead, index) => ({ key: keyFor(lead, index), lead, stage: "checking", triggers: [] }));
      setRows(initial);
      setProgress({ done: 0, total: initial.length });
      const pending = [...initial];
      const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (pending.length) {
          const row = pending.shift();
          if (!row) return;
          try {
            const check = await precheckLead(row.lead);
            setRows((current) => current.map((item) => item.key === row.key ? { ...item, precheck: check, stage: stageFromCheck(check) } : item));
          } catch (requestError) {
            setRows((current) => current.map((item) => item.key === row.key ? { ...item, stage: "error", error: requestError instanceof Error ? requestError.message : "Precheck failed." } : item));
          } finally {
            setProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }
      });
      await Promise.all(workers);
      setMessage(`Dry run complete for ${initial.length} contacts. Existing people, no-email rows and already-engaged companies are separated before Push.`);
    } catch (fileError) {
      setRows([]);
      setError(fileError instanceof Error ? fileError.message : "Could not read SignalHire CSV.");
    } finally {
      setProcessing(false);
    }
  }

  function toggleTrigger(rowKey: string, trigger: TriggerKey) {
    setRows((current) => current.map((row) => {
      if (row.key !== rowKey || row.stage !== "ready") return row;
      const triggers = row.triggers.includes(trigger) ? row.triggers.filter((item) => item !== trigger) : [...row.triggers, trigger];
      return { ...row, triggers };
    }));
  }

  async function pushRow(row: Row, stayOnView = false) {
    if (row.stage !== "ready" || !ownerId) return false;
    setRows((current) => current.map((item) => item.key === row.key ? { ...item, push: { loading: true } } : item));
    try {
      const response = await fetch("/api/prospecting/manual-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskOwnerId: ownerId, triggers: row.triggers, prospect: prospectPayload(row, fileName || "SignalHire.csv") }),
      });
      const payload = await response.json() as { duplicate?: boolean; taskId?: string; taskOwnerName?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Push failed.");
      const success = payload.duplicate
        ? `Existing open task refreshed · ${payload.taskId || "kept"}`
        : `Created task for ${payload.taskOwnerName || "selected owner"} · ${payload.taskId || "done"}`;
      setRows((current) => current.map((item) => item.key === row.key ? { ...item, stage: "pushed", push: { success, taskId: payload.taskId } } : item));
      setSelected((current) => { const next = new Set(current); next.delete(row.key); return next; });
      setMessage(`${row.lead.name}: ${success}`);
      if (!stayOnView) setView("pushed");
      return true;
    } catch (pushError) {
      setRows((current) => current.map((item) => item.key === row.key ? { ...item, push: { error: pushError instanceof Error ? pushError.message : "Push failed." } } : item));
      setError(pushError instanceof Error ? pushError.message : "Push failed.");
      return false;
    }
  }

  async function pushSelected() {
    if (!ownerId) { setError("Choose the HubSpot task owner first."); return; }
    const queue = rows.filter((row) => row.stage === "ready" && selected.has(row.key));
    if (!queue.length) return;
    setBulk({ loading: true, done: 0, total: queue.length });
    let success = 0;
    for (const row of queue) {
      if (await pushRow(row, true)) success += 1;
      setBulk((current) => ({ ...current, done: current.done + 1 }));
    }
    setBulk((current) => ({ ...current, loading: false }));
    setMessage(`Finished ${success}/${queue.length} selected pushes. Open the Pushed tab for HubSpot task links.`);
    setView("pushed");
  }

  const counts = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((row) => row.stage === "ready").length,
    existing: rows.filter((row) => row.stage === "existing").length,
    engaged: rows.filter((row) => row.stage === "engaged").length,
    retention: rows.filter((row) => row.stage === "retention").length,
    protected: rows.filter((row) => row.stage === "protected").length,
    pushed: rows.filter((row) => row.stage === "pushed").length,
    review: rows.filter((row) => row.stage === "error").length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view !== "all" && row.stage !== view) return false;
      if (!term) return true;
      return [
        row.lead.name,
        row.lead.title,
        row.lead.company,
        row.lead.email,
        row.lead.phone,
        row.precheck?.company.accountType,
        row.precheck?.company.accountStatus,
        row.precheck?.company.engagementReason,
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [query, rows, view]);

  const eligibleVisible = visible.filter((row) => row.stage === "ready");
  const selectedCount = rows.filter((row) => row.stage === "ready" && selected.has(row.key)).length;
  const allVisibleSelected = eligibleVisible.length > 0 && eligibleVisible.every((row) => selected.has(row.key));
  const ownerName = owners.find((owner) => owner.id === ownerId)?.name || "";

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of eligibleVisible) {
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
          <span className={styles.eyebrow}><FileSpreadsheet size={14}/>SIGNALHIRE IMPORT</span>
          <h1>New Person → Check Company Engagement → Choose Trigger → Push</h1>
          <p>A company can already exist in HubSpot and still be valid. We block rows when the person exists, email is missing, the company is Retention/protected, or the company already has a connected call or meaningful meeting.</p>
        </div>
        <div className={styles.guardrails}><span><ShieldCheck size={13}/>New people + email only</span><span><PhoneCall size={13}/>Connected call guard</span><span><CalendarCheck2 size={13}/>Meeting guard</span></div>
      </header>

      <section className={styles.controlGrid}>
        <div className={styles.uploadCard}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void processFile(file); event.currentTarget.value = ""; }}/>
          <Upload size={20}/><div><strong>{fileName || "SignalHire CSV"}</strong><small>Upload the export. The dry run checks the person, company, connected calls and meetings before any write.</small></div>
          <button onClick={() => fileRef.current?.click()} disabled={processing}>{processing ? "Checking…" : "Choose CSV"}</button>
        </div>
        <label className={styles.ownerCard}><span>Task owner override</span><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">Choose owner…</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select><small>{ownerName ? `${ownerName} will receive every task you push.` : "Required before Push. This bypasses automatic SDR task routing."}</small></label>
      </section>

      {processing && <div className={styles.notice}><LoaderCircle className={styles.spin} size={15}/>Dry run {progress.done}/{progress.total} — checking people, companies, calls and meetings.</div>}
      {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
      {message && !processing && <div className={styles.notice}><CheckCircle2 size={15}/>{message}</div>}

      <section className={styles.metrics}>
        <article><UsersRound size={17}/><span>Uploaded</span><strong>{counts.total}</strong></article>
        <article><Send size={17}/><span>Ready</span><strong>{counts.ready}</strong></article>
        <article><UserCheck size={17}/><span>Existing person</span><strong>{counts.existing}</strong></article>
        <article><PhoneCall size={17}/><span>Engaged company</span><strong>{counts.engaged}</strong></article>
        <article><ShieldCheck size={17}/><span>Retention</span><strong>{counts.retention}</strong></article>
        <article><Building2 size={17}/><span>Protected</span><strong>{counts.protected}</strong></article>
        <article><CheckCircle2 size={17}/><span>Pushed</span><strong>{counts.pushed}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.views}>
          {(["ready","existing","engaged","retention","protected","pushed","review","all"] as View[]).map((item) => <button key={item} data-active={view === item} onClick={() => setView(item)}>{VIEW_LABELS[item]} <b>{item === "all" ? counts.total : counts[item as keyof typeof counts]}</b></button>)}
        </div>
        <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, company, engagement…"/>
      </section>

      <section className={styles.selection}>
        <button onClick={toggleVisible} disabled={!eligibleVisible.length}>{allVisibleSelected ? "Unselect visible" : "Select ready"}</button>
        <span><b>{selectedCount}</b> selected</span>
        <small>Ready = new person + valid email + no connected call/meeting at the company. Existing companies with no meaningful engagement are still allowed.</small>
        <button className={styles.primary} onClick={() => void pushSelected()} disabled={!selectedCount || !ownerId || bulk.loading}>{bulk.loading ? <LoaderCircle className={styles.spin} size={14}/> : <Send size={14}/>}{bulk.loading ? `Pushing ${bulk.done}/${bulk.total}` : "Push selected + Tasks"}</button>
      </section>

      <section className={styles.tablePanel}><div className={styles.tableWrap}><table><thead><tr><th/><th>Lead</th><th>Contact data</th><th>HubSpot person / company</th><th>Why now / trigger</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {visible.map((row) => {
          const company = row.precheck?.company;
          const latestTouch = formatDate(company?.latestEngagementAt || "");
          return <tr key={row.key} data-blocked={["retention", "protected", "engaged", "existing"].includes(row.stage)}>
            <td><input type="checkbox" disabled={row.stage !== "ready"} checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}/></td>
            <td><strong>{row.lead.name}</strong><span>{row.lead.title || "—"}</span><small>{row.lead.company || "—"}</small>{row.lead.linkedinUrl && <a href={row.lead.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn <ExternalLink size={10}/></a>}</td>
            <td><strong>{row.lead.phone || "No phone"}</strong><span>{row.lead.email || "No email"}</span><small>{row.lead.phones.length} phones · {row.lead.emails.length} emails</small></td>
            <td className={styles.hubspotCheck}>
              {row.stage === "checking" ? <span>Checking…</span> : row.precheck?.contact.inHubSpot
                ? <strong className={styles.bad}>Person: already exists · matched by {row.precheck.contact.matchedBy}</strong>
                : <strong className={styles.good}>Person: new</strong>}
              {!company ? null : company.inHubSpot ? <>
                <small><b>Company:</b> existing · {company.accountType || "unclassified"}{company.accountStatus ? ` · ${company.accountStatus}` : ""}</small>
                {company.engaged
                  ? <small className={styles.bad}><b>Engagement:</b> {company.connectedCallCount} connected call(s) · {company.meetingCount} meeting(s){latestTouch ? ` · latest ${latestTouch}` : ""} → skip company</small>
                  : <small className={styles.good}><b>Engagement:</b> no connected call / meeting → this new person is allowed</small>}
                {company.openDeals ? <small className={styles.bad}>{company.openDeals} open deal(s)</small> : null}
              </> : <small className={styles.good}><b>Company:</b> new in HubSpot</small>}
            </td>
            <td><details className={styles.triggerPicker}><summary>{row.stage !== "ready" ? "Not needed — blocked" : row.triggers.length ? `${row.triggers.length} selected` : "Choose triggers"}</summary><div>{TRIGGERS.map((trigger) => <label key={trigger.key}><input type="checkbox" disabled={row.stage !== "ready"} checked={row.triggers.includes(trigger.key)} onChange={() => toggleTrigger(row.key, trigger.key)}/><span>{trigger.label}</span></label>)}</div></details>{row.triggers.length ? <small>{row.triggers.map((key) => TRIGGERS.find((item) => item.key === key)?.label).filter(Boolean).join(" · ")}</small> : null}</td>
            <td><span className={`${styles.badge} ${styles[row.stage]}`}>{row.stage === "existing" ? "existing person" : row.stage === "engaged" ? "engaged company" : row.stage}</span>{row.error && <small className={styles.bad}>{row.error}</small>}{row.push?.success && <small className={styles.good}>{row.push.success}</small>}{row.push?.error && <small className={styles.bad}>{row.push.error}</small>}{row.push?.taskId && <a href={`https://app.hubspot.com/tasks/145742477/view/all/task/${row.push.taskId}`} target="_blank" rel="noreferrer">Open HubSpot task <ExternalLink size={10}/></a>}</td>
            <td><button className={styles.pushButton} disabled={row.stage !== "ready" || !ownerId || row.push?.loading} onClick={() => void pushRow(row)}>{row.push?.loading ? <LoaderCircle className={styles.spin} size={13}/> : <Send size={13}/>}Push + Task</button></td>
          </tr>;
        })}
        {!visible.length && <tr><td className={styles.empty} colSpan={7}>{rows.length ? "No rows in this view." : "Upload the SignalHire CSV to start."}</td></tr>}
      </tbody></table></div></section>
      <div className={styles.footerLink}><Link href="/signalhire-companion">Open Companion queue instead</Link></div>
    </div>
  </main>;
}
