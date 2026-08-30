"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
  Filter,
  LoaderCircle,
  Mail,
  Phone,
  Send,
  ShieldCheck,
  Upload,
  UserCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { parseSignalHireCsv, type SignalHireCsvLead } from "@/lib/signalhire-csv";
import styles from "./LeadImportPush.module.css";

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
  protected: boolean;
  protectedReason: string;
};

type Precheck = {
  contact: ContactCheck;
  company: CompanyCheck;
  checkedAt: string;
};

type Stage = "checking" | "ready" | "existing" | "retention" | "protected" | "error" | "pushed";
type View = "ready" | "existing" | "retention" | "protected" | "review" | "pushed" | "all";

type PushResult = {
  loading?: boolean;
  success?: string;
  error?: string;
  taskId?: string;
  contactId?: string;
  companyId?: string;
};

type Row = {
  key: string;
  lead: SignalHireCsvLead;
  stage: Stage;
  precheck?: Precheck;
  error?: string;
  push?: PushResult;
};

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keyFor(lead: SignalHireCsvLead, index: number) {
  return lead.id || lead.linkedinUrl || lead.email || lead.phone || `${lead.name}:${lead.company}:${index}`;
}

function isRetention(company?: CompanyCheck) {
  return String(company?.accountType || "").trim().toLowerCase() === "retention";
}

function companyLabel(company?: CompanyCheck) {
  if (!company) return "Checking HubSpot";
  if (!company.inHubSpot) return "New company";
  const parts = [company.accountType || "Unclassified", company.accountStatus].filter(Boolean);
  if (company.openDeals) parts.push(`${company.openDeals} open deal${company.openDeals === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function scoreLead(lead: SignalHireCsvLead) {
  const reasons: Array<{ label: string; points: number }> = [];
  if (lead.businessEmails.length) reasons.push({ label: "Business email available", points: 20 });
  if (lead.phones.length) reasons.push({ label: "Phone number available", points: 20 });
  if (lead.linkedinUrl) reasons.push({ label: "LinkedIn profile available", points: 10 });
  if (lead.companyDomain) reasons.push({ label: "Company domain available", points: 10 });
  if (/\b(chief|c-level|vp|vice president|director|head|general manager)\b/i.test(lead.title)) {
    reasons.push({ label: "Senior decision-maker title", points: 15 });
  }
  const score = Math.min(100, 25 + reasons.reduce((sum, reason) => sum + reason.points, 0));
  return {
    score,
    priority: score >= 75 ? "high" as const : score >= 55 ? "medium" as const : "normal" as const,
    reasons,
  };
}

function prospectPayload(row: Row, fileName: string) {
  const { lead, precheck } = row;
  const scored = scoreLead(lead);
  const company = precheck?.company;
  return {
    linkedinUrl: lead.linkedinUrl,
    source: `SignalHire CSV · ${fileName}`.slice(0, 120),
    signalHireUid: lead.id.slice(0, 160),
    fullName: lead.name,
    title: lead.title,
    company: lead.company,
    companyWebsite: lead.companyWebsite,
    companyDomain: lead.companyDomain || company?.domain || "",
    careerPageUrl: company?.careerPageUrl || "",
    detectedAts: company?.detectedAts || "",
    companyEvidenceUrl: lead.companyWebsite || company?.careerPageUrl || "",
    companyVerificationReason: company?.inHubSpot
      ? `HubSpot company matched by ${company.matchedBy || "existing record"}.`
      : "Identity imported from SignalHire CSV and checked against HubSpot before push.",
    location: lead.location,
    email: lead.email,
    emails: unique(lead.emails),
    phone: lead.phone,
    phones: unique(lead.phones),
    score: scored.score,
    priority: scored.priority,
    recentSignal: { type: "signalhire_csv", label: "Imported from SignalHire CSV" },
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

function nextStage(check: Precheck): Stage {
  if (isRetention(check.company)) return "retention";
  if (check.contact.inHubSpot) return "existing";
  if (check.company.protected) return "protected";
  return "ready";
}

function accountTone(company?: CompanyCheck) {
  if (isRetention(company)) return "bad";
  if (company?.protected) return "bad";
  if (company?.accountType.toLowerCase() === "acquisition") return "good";
  if (company?.inHubSpot) return "warn";
  return "good";
}

export function LeadImportPush() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [skipped, setSkipped] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("ready");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ loading: false, done: 0, total: 0 });
  const [dragging, setDragging] = useState(false);

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Upload the CSV exported directly from SignalHire.");
      return;
    }

    setProcessing(true);
    setError("");
    setMessage("");
    setSelected(new Set());
    setFileName(file.name);

    try {
      const parsed = parseSignalHireCsv(await file.text());
      setSkipped(parsed.skipped);
      const initial = parsed.leads.map((lead, index) => ({ key: keyFor(lead, index), lead, stage: "checking" as const }));
      setRows(initial);
      setProgress({ done: 0, total: initial.length });

      const pending = [...initial];
      const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (pending.length) {
          const item = pending.shift();
          if (!item) return;
          try {
            const check = await precheckLead(item.lead);
            setRows((current) => current.map((row) => row.key === item.key
              ? { ...row, precheck: check, stage: nextStage(check), error: undefined }
              : row));
          } catch (requestError) {
            setRows((current) => current.map((row) => row.key === item.key
              ? { ...row, stage: "error", error: requestError instanceof Error ? requestError.message : "Precheck failed." }
              : row));
          } finally {
            setProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }
      });

      await Promise.all(workers);
      setMessage(`Analyzed ${initial.length} SignalHire contacts. Nothing was written to HubSpot yet.`);
    } catch (parseError) {
      setRows([]);
      setError(parseError instanceof Error ? parseError.message : "Could not read this SignalHire CSV.");
    } finally {
      setProcessing(false);
    }
  }

  async function pushRow(row: Row) {
    if (row.stage !== "ready" || row.push?.loading || row.push?.success) return false;
    setRows((current) => current.map((item) => item.key === row.key ? { ...item, push: { loading: true } } : item));
    try {
      const response = await fetch("/api/prospecting/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prospectPayload(row, fileName || "SignalHire_exports.csv")),
      });
      const payload = await response.json() as {
        duplicate?: boolean;
        taskId?: string;
        contactId?: string;
        companyId?: string;
        ownerName?: string;
        phonesStoredInTask?: number;
        emailsStoredInTask?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "HubSpot push failed.");
      const success = payload.duplicate
        ? `Existing open task kept · ${payload.taskId || "task found"}`
        : `Pushed to ${payload.ownerName || "HubSpot"} · task ${payload.taskId || "created"}`;
      setRows((current) => current.map((item) => item.key === row.key ? {
        ...item,
        stage: "pushed",
        push: { success, taskId: payload.taskId, contactId: payload.contactId, companyId: payload.companyId },
      } : item));
      setSelected((current) => { const next = new Set(current); next.delete(row.key); return next; });
      return true;
    } catch (pushError) {
      setRows((current) => current.map((item) => item.key === row.key ? {
        ...item,
        push: { error: pushError instanceof Error ? pushError.message : "Push failed." },
      } : item));
      return false;
    }
  }

  async function pushSelected() {
    const queue = rows.filter((row) => selected.has(row.key) && row.stage === "ready" && !row.push?.success);
    if (!queue.length) return;
    setBulk({ loading: true, done: 0, total: queue.length });
    const pending = [...queue];
    const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
      while (pending.length) {
        const row = pending.shift();
        if (!row) return;
        await pushRow(row);
        setBulk((current) => ({ ...current, done: current.done + 1 }));
      }
    });
    await Promise.all(workers);
    setBulk((current) => ({ ...current, loading: false }));
  }

  const counts = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((row) => row.stage === "ready").length,
    existing: rows.filter((row) => row.stage === "existing").length,
    retention: rows.filter((row) => isRetention(row.precheck?.company)).length,
    protected: rows.filter((row) => row.stage === "protected").length,
    pushed: rows.filter((row) => row.stage === "pushed").length,
    review: rows.filter((row) => row.stage === "error").length,
    phones: rows.filter((row) => row.lead.phones.length > 0).length,
  }), [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === "ready" && row.stage !== "ready") return false;
      if (view === "existing" && row.stage !== "existing") return false;
      if (view === "retention" && !isRetention(row.precheck?.company)) return false;
      if (view === "protected" && row.stage !== "protected") return false;
      if (view === "review" && row.stage !== "error") return false;
      if (view === "pushed" && row.stage !== "pushed") return false;
      if (!term) return true;
      const company = row.precheck?.company;
      return [row.lead.name, row.lead.title, row.lead.company, row.lead.email, row.lead.phone, company?.accountType, company?.accountStatus, company?.domain]
        .some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [query, rows, view]);

  const eligibleVisible = visible.filter((row) => row.stage === "ready" && !row.push?.success);
  const allVisibleSelected = eligibleVisible.length > 0 && eligibleVisible.every((row) => selected.has(row.key));
  const selectedCount = rows.filter((row) => row.stage === "ready" && selected.has(row.key)).length;

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

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void processFile(file);
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.back}><ArrowLeft size={15}/>SDR Command Center</Link>
          <span className={styles.eyebrow}><FileSpreadsheet size={14}/>LEAD IMPORT & PUSH</span>
          <h1>SignalHire CSV → HubSpot Dry Run → Push + Task</h1>
          <p>Upload the SignalHire export, review existing contacts and company classification, then push only the clean rows you select. Retention accounts and companies with open deals are blocked by default.</p>
        </div>
        <div className={styles.guardrails}>
          <span><ShieldCheck size={13}/>Dry run first</span>
          <span><ShieldCheck size={13}/>Retention protected</span>
          <span><Phone size={13}/>All phones in task</span>
        </div>
      </header>

      <section className={styles.importGrid}>
        <div
          className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void processFile(file); event.currentTarget.value = ""; }}/>
          <span className={styles.uploadIcon}><Upload size={20}/></span>
          <div><strong>{fileName || "Upload SignalHire CSV"}</strong><small>Drop the export here or choose a CSV. Multiline SignalHire fields are parsed safely.</small></div>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={processing}>{processing ? "Analyzing…" : rows.length ? "Choose another file" : "Choose CSV"}</button>
        </div>
        <div className={styles.flowCard}>
          <strong>What the dry run checks</strong>
          <div><span>1</span><p><b>Contact</b><small>Email → LinkedIn → phone</small></p></div>
          <div><span>2</span><p><b>Company</b><small>Website/domain → exact name</small></p></div>
          <div><span>3</span><p><b>Safety</b><small>Acquisition / Retention / open deals</small></p></div>
          <div><span>4</span><p><b>Push</b><small>Contact + company association + formatted task</small></p></div>
        </div>
      </section>

      {processing && <div className={styles.notice}><LoaderCircle className={styles.spin} size={15}/>HubSpot dry run {progress.done}/{progress.total} — no writes yet.</div>}
      {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
      {message && !processing && <div className={styles.notice}><CheckCircle2 size={15}/>{message}{skipped ? ` ${skipped} unusable row${skipped === 1 ? " was" : "s were"} skipped.` : ""}</div>}

      <section className={styles.metrics}>
        <article><UsersRound size={17}/><span>Uploaded</span><strong>{counts.total}</strong></article>
        <article><UserPlus size={17}/><span>Ready to push</span><strong>{counts.ready}</strong></article>
        <article><UserCheck size={17}/><span>Contact exists</span><strong>{counts.existing}</strong></article>
        <article><ShieldCheck size={17}/><span>Retention</span><strong>{counts.retention}</strong></article>
        <article><Building2 size={17}/><span>Other protected</span><strong>{counts.protected}</strong></article>
        <article><CheckCircle2 size={17}/><span>Pushed</span><strong>{counts.pushed}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.views}>
          <button data-active={view === "ready"} onClick={() => setView("ready")}>Ready <b>{counts.ready}</b></button>
          <button data-active={view === "existing"} onClick={() => setView("existing")}>Existing <b>{counts.existing}</b></button>
          <button data-active={view === "retention"} onClick={() => setView("retention")}>Retention <b>{counts.retention}</b></button>
          <button data-active={view === "protected"} onClick={() => setView("protected")}>Protected <b>{counts.protected}</b></button>
          <button data-active={view === "pushed"} onClick={() => setView("pushed")}>Pushed <b>{counts.pushed}</b></button>
          <button data-active={view === "review"} onClick={() => setView("review")}>Review <b>{counts.review}</b></button>
          <button data-active={view === "all"} onClick={() => setView("all")}>All <b>{counts.total}</b></button>
        </div>
        <label className={styles.search}><Filter size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lead, company, account type…"/></label>
      </section>

      <section className={styles.selection}>
        <button type="button" onClick={toggleVisible} disabled={!eligibleVisible.length}>{allVisibleSelected ? "Unselect visible" : "Select ready"}</button>
        <span><strong>{selectedCount}</strong> selected for push</span>
        <small>Business email is used as the HubSpot primary email. Personal emails and every phone number stay in the task details.</small>
        <button className={styles.pushSelected} type="button" onClick={() => void pushSelected()} disabled={!selectedCount || bulk.loading}>
          {bulk.loading ? <LoaderCircle className={styles.spin} size={14}/> : <Send size={14}/>}
          {bulk.loading ? `Pushing ${bulk.done}/${bulk.total}` : `Push ${selectedCount || "selected"} + Tasks`}
        </button>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.tableHeader}>
          <div><h2>{fileName || "SignalHire import"}</h2><p>Review is read-only until you click Push. Rows marked Retention or Protected cannot be selected.</p></div>
          <div><span>{visible.length} visible</span><Link href="/signalhire-queue">Companion queue</Link></div>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th/><th>Lead</th><th>Contact data</th><th>HubSpot contact</th><th>Company / account</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {visible.map((row) => {
                const company = row.precheck?.company;
                const contact = row.precheck?.contact;
                const tone = accountTone(company);
                const canPush = row.stage === "ready" && !row.push?.success;
                return <tr key={row.key} data-blocked={row.stage === "retention" || row.stage === "protected"}>
                  <td><input type="checkbox" disabled={!canPush} checked={selected.has(row.key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; })}/></td>
                  <td>
                    <strong>{row.lead.name}</strong>
                    <span>{row.lead.title || "—"}</span>
                    <small>{row.lead.location || "—"}</small>
                    {row.lead.linkedinUrl && <a href={row.lead.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}
                  </td>
                  <td>
                    {row.lead.phone ? <strong className={styles.phone}><Phone size={12}/>{row.lead.phone}</strong> : <span className={styles.muted}>No phone</span>}
                    {row.lead.email ? <span className={styles.workEmail}><Mail size={11}/>{row.lead.email}<em>work</em></span> : <small className={styles.warnText}>No business email</small>}
                    <details className={styles.details}>
                      <summary>{row.lead.phones.length} phones · {row.lead.emails.length} emails</summary>
                      {row.lead.phones.map((phone) => <small key={phone}>📱 {phone}</small>)}
                      {row.lead.businessEmails.map((email) => <small key={email}>💼 {email}</small>)}
                      {row.lead.personalEmails.map((email) => <small key={email}>👤 {email}</small>)}
                    </details>
                  </td>
                  <td>
                    {row.stage === "checking" ? <span className={styles.muted}>Checking…</span> : contact?.inHubSpot
                      ? <><strong className={styles.badText}>Already exists</strong><small>Matched by {contact.matchedBy}</small></>
                      : <strong className={styles.goodText}>New contact</strong>}
                  </td>
                  <td>
                    <strong>{company?.name || row.lead.company || "—"}</strong>
                    <span>{company?.domain || row.lead.companyDomain || ""}</span>
                    <small className={tone === "bad" ? styles.badText : tone === "warn" ? styles.warnText : styles.goodText}>{companyLabel(company)}</small>
                    {company?.inHubSpot && <small>Matched by {company.matchedBy}</small>}
                  </td>
                  <td>
                    {row.stage === "checking" && <span className={styles.badge}><LoaderCircle className={styles.spin} size={11}/>Dry run</span>}
                    {row.stage === "ready" && <span className={styles.goodBadge}><CheckCircle2 size={11}/>Ready to push</span>}
                    {row.stage === "existing" && <span className={styles.existingBadge}><UserCheck size={11}/>Contact exists</span>}
                    {row.stage === "retention" && <span className={styles.retentionBadge}><ShieldCheck size={11}/>Retention — blocked</span>}
                    {row.stage === "protected" && <span className={styles.protectedBadge}><ShieldCheck size={11}/>{company?.protectedReason || "Protected"}</span>}
                    {row.stage === "error" && <span className={styles.errorBadge}><CircleAlert size={11}/>Needs review</span>}
                    {row.stage === "pushed" && <span className={styles.pushedBadge}><CheckCircle2 size={11}/>Pushed + task</span>}
                    {row.error && <small className={styles.rowError}>{row.error}</small>}
                    {row.push?.success && <small className={styles.goodText}>{row.push.success}</small>}
                    {row.push?.error && <small className={styles.badText}>{row.push.error}</small>}
                  </td>
                  <td>
                    <button className={styles.pushButton} type="button" disabled={!canPush || row.push?.loading} onClick={() => void pushRow(row)}>
                      {row.push?.loading ? <LoaderCircle className={styles.spin} size={13}/> : <Send size={13}/>}
                      {row.stage === "pushed" ? "Pushed" : "Push + Task"}
                    </button>
                  </td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={7} className={styles.empty}>{rows.length ? "No rows match this view." : "Upload a SignalHire CSV to start the dry run."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>;
}
