"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft, Bot, CheckCircle2, CircleAlert, ClipboardCopy, ExternalLink,
  LoaderCircle, Phone, Radar, SearchCheck, Send, ShieldCheck, Sparkles,
} from "lucide-react";
import {
  AI_SDR_BATCH_LIMIT, aiLeadKey, assessAiSdrLead, parseAiSdrBatch,
  type AiAssessment, type AiCrmCheck, type AiLead,
} from "@/lib/ai-sdr-qualification";
import styles from "./AiSdrAgentWorkspace.module.css";

type LeadStage = "pending" | "checking" | "checked" | "revealing" | "revealed" | "pushed" | "error";
type LeadRow = {
  key: string;
  lead: AiLead;
  stage: LeadStage;
  runId: string;
  check?: AiCrmCheck;
  prospect?: Record<string, unknown>;
  error?: string;
  message?: string;
  cachedReveal?: boolean;
  creditUsed?: boolean;
};
type SalesNavLead = { name: string; title: string; company: string; location: string; linkedinUrl: string; salesLeadUrl: string; connectionDegree?: string };
type SalesNavRun = { id: string; total: number; leads: SalesNavLead[]; sourceUrl?: string };

const INTRO_PROMPT = [
  "Act as a careful Saudi GTM and SDR researcher for Talentera / Evalufy.",
  "Find up to 20 distinct Saudi PRIVATE-SECTOR companies with at least 250 employees and one verified current decision-maker per company.",
  "Prioritize HR Directors, Heads of HR, Talent Acquisition leaders, or relevant assessment/admissions decision-makers. Do not include government entities, agencies, job seekers or speculative identities.",
  "Use public sources or sources you are authorized to access; do not scrape or automate LinkedIn.",
  "Do not fabricate employee count, company domain, name, LinkedIn person URL, hiring activity or ATS. Use null for unknown employeeCount. Include companyCountry only when supported by evidence.",
  "Return ONLY valid JSON with a leads array. Each person needs: name, title, company, location, linkedinUrl, companyDomain, companyCountry, employeeCount (integer or null), detectedAts (hint only), sector.",
  "Example output: {\"leads\":[{\"name\":\"Example Person\",\"title\":\"HR Director\",\"company\":\"Example Company\",\"location\":\"Riyadh\",\"linkedinUrl\":\"https://www.linkedin.com/in/example-person\",\"companyDomain\":\"example.com\",\"companyCountry\":\"Saudi Arabia\",\"employeeCount\":500,\"detectedAts\":\"\",\"sector\":\"Private\"}]}",
  "Never invent emails or phone numbers. Dashboard will verify each person against HubSpot and will require separate approval before any contact-data reveal or CRM write.",
].join("\n\n");

function tomorrowRiyadh() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(Date.now() + 86_400_000));
  const value = (type: string) => parts.find(part => part.type === type)?.value || "01";
  return [value("year"), value("month"), value("day")].join("-");
}

function hasVerifiedPhone(row: LeadRow): boolean {
  if (!row.prospect) return false;
  return Boolean(String(row.prospect.phone || "").trim()
    || (Array.isArray(row.prospect.phones) && row.prospect.phones.some(value => String(value || "").trim())));
}

function assessment(row: LeadRow): AiAssessment {
  return assessAiSdrLead(row.lead, row.check);
}

function selectable(row: LeadRow) {
  const eligible = assessment(row).status === "eligible";
  return eligible && ((row.stage === "checked" && !row.prospect) || (row.stage === "revealed" && hasVerifiedPhone(row)));
}

async function responseJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json().catch(() => ({}));
  return value as T;
}

function crmPayload(lead: AiLead) {
  return {
    name: lead.name, company: lead.company, linkedinUrl: lead.linkedinUrl,
    companyDomain: lead.companyDomain, companyWebsite: "",
    email: "", emails: [], phone: "", phones: [],
  };
}

function rowFromLead(lead: AiLead, runId = ""): LeadRow {
  return { key: aiLeadKey(lead), lead, runId, stage: "pending" };
}

export function AiSdrAgentWorkspace() {
  const [rawImport, setRawImport] = useState("");
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "source" | "check" | "reveal" | "push">("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState(INTRO_PROMPT);
  const [dueDate, setDueDate] = useState(tomorrowRiyadh);
  const [dueTime, setDueTime] = useState("09:00");
  const [confirmedReveals, setConfirmedReveals] = useState(0);
  const [confirmedPushes, setConfirmedPushes] = useState(0);

  const stats = useMemo(() => ({
    total: rows.length,
    blocked: rows.filter(row => row.check && assessment(row).status === "blocked").length,
    review: rows.filter(row => row.check && assessment(row).status === "review").length,
    eligible: rows.filter(row => row.check && assessment(row).status === "eligible" && row.stage !== "pushed").length,
    phone: rows.filter(row => row.stage === "revealed" && hasVerifiedPhone(row)).length,
    pushed: rows.filter(row => row.stage === "pushed").length,
  }), [rows]);

  const checked = rows.filter(row => row.check).length;
  const revealQueue = rows.filter(row => selected.has(row.key) && row.stage === "checked" && assessment(row).status === "eligible");
  const pushQueue = rows.filter(row => selected.has(row.key) && row.stage === "revealed" && hasVerifiedPhone(row) && assessment(row).status === "eligible");

  function addLeads(leads: AiLead[], runId = "") {
    setRows(current => {
      const map = new Map(current.map(row => [row.key, row]));
      for (const lead of leads) {
        const key = aiLeadKey(lead);
        if (!map.has(key) && map.size < AI_SDR_BATCH_LIMIT) map.set(key, rowFromLead(lead, runId));
      }
      return [...map.values()];
    });
    setSelected(new Set());
  }

  function importJson() {
    setError("");
    try {
      const result = parseAiSdrBatch(rawImport);
      if (!result.leads.length) throw new Error("No valid, unique LinkedIn people were found.");
      addLeads(result.leads);
      setNotice("Imported " + result.leads.length + " unique people. "
        + (result.rejected ? result.rejected + " invalid/duplicate rows skipped. " : "")
        + (result.truncated ? "Batch capped at " + AI_SDR_BATCH_LIMIT + " for a safe pilot. " : "")
        + "ATS suggestions from AI are unverified until you review them.");
    } catch (err) { setError(err instanceof Error ? err.message : "Invalid JSON batch."); }
  }

  async function loadSalesNav() {
    if (busy) return;
    setBusy("source"); setError("");
    try {
      const response = await fetch("/api/prospecting/salesnav/full-run", { cache: "no-store" });
      const result = await responseJson<{ run?: SalesNavRun | null; error?: string }>(response);
      if (!response.ok) throw new Error(response.status === 401
        ? "Unlock Sales Navigator Companion settings first, then reload this batch."
        : result.error || "Could not load the saved Sales Navigator run.");
      if (!result.run?.leads?.length) throw new Error("No saved Sales Navigator batch found. Open Sales Nav Source to prepare one.");
      const leads = result.run.leads
        .filter(lead => String(lead.connectionDegree || "").toLowerCase() !== "1st")
        .slice(0, AI_SDR_BATCH_LIMIT)
        .map(lead => ({
          name: lead.name, title: lead.title, company: lead.company, location: lead.location,
          linkedinUrl: lead.linkedinUrl, salesLeadUrl: lead.salesLeadUrl,
          companyDomain: "", companyCountry: "", employeeCount: null,
          detectedAts: "", atsStatus: "unknown" as const, atsEvidence: "", sector: "",
        }))
        .filter(lead => lead.name && lead.company && lead.linkedinUrl);
      addLeads(leads, result.run.id);
      setNotice("Loaded " + leads.length + " people from the saved Sales Nav batch. Verify company country, headcount and ATS before any reveal.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to read Sales Nav batch."); }
    finally { setBusy(""); }
  }

  function updateLead(key: string, patch: Partial<AiLead>) {
    setRows(current => current.map(row => row.key === key
      ? { ...row, lead: { ...row.lead, ...patch } } : row));
    setSelected(current => { const next = new Set(current); next.delete(key); return next; });
  }

  function toggleSelected(key: string) {
    setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }

  function selectEligible(mode: "reveal" | "push") {
    setSelected(new Set(rows.filter(row => assessment(row).status === "eligible"
      && (mode === "reveal" ? row.stage === "checked" : row.stage === "revealed" && hasVerifiedPhone(row))).map(row => row.key)));
  }

  async function runPrecheck() {
    if (busy || !rows.length) return;
    setBusy("check"); setError(""); setSelected(new Set());
    const pending = rows.filter(row => row.stage !== "pushed");
    setProgress({ done: 0, total: pending.length });
    const queue = [...pending];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!row) return;
        setRows(current => current.map(item => item.key === row.key ? { ...item, stage: "checking", error: undefined } : item));
        try {
          const response = await fetch("/api/prospecting/salesnav/precheck-v2", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(crmPayload(row.lead)),
          });
          const result = await responseJson<AiCrmCheck & { error?: string }>(response);
          if (!response.ok || !result.contact || !result.company) throw new Error(result.error || "HubSpot precheck failed.");
          setRows(current => current.map(item => item.key === row.key
            ? { ...item, check: result, stage: "checked", prospect: undefined, error: undefined } : item));
        } catch (err) {
          setRows(current => current.map(item => item.key === row.key
            ? { ...item, stage: "error", check: undefined, error: err instanceof Error ? err.message : "HubSpot error." } : item));
        } finally { setProgress(value => ({ ...value, done: value.done + 1 })); }
      }
    });
    await Promise.all(workers);
    setNotice("Precheck complete. Existing contacts, meetings, connected calls, open deals, Retention and uncertain targeting are not auto-approved.");
    setBusy("");
  }

  async function revealSelected() {
    if (busy || !revealQueue.length) return;
    if (!window.confirm("Reveal " + revealQueue.length + " people via SignalHire? First-time reveals MAY USE CONTACT CREDITS. No CRM records will be created yet.")) return;
    setBusy("reveal"); setError(""); setProgress({ done: 0, total: revealQueue.length });
    const queue = [...revealQueue];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift(); if (!row) return;
        setRows(current => current.map(item => item.key === row.key ? { ...item, stage: "revealing", error: undefined } : item));
        try {
          const response = await fetch("/api/prospecting/salesnav/reveal-fast", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId: row.runId, lead: {
                name: row.lead.name, title: row.lead.title, company: row.lead.company,
                location: row.lead.location, linkedinUrl: row.lead.linkedinUrl, salesLeadUrl: row.lead.salesLeadUrl,
              },
            }),
          });
          const result = await responseJson<{
            prospect?: Record<string, unknown> | null;
            postRevealCheck?: AiCrmCheck;
            cached?: boolean;
            creditUsed?: boolean;
            message?: string;
            error?: string;
          }>(response);
          if (!response.ok) throw new Error(result.error || "SignalHire reveal failed.");
          if (result.creditUsed) setConfirmedReveals(value => value + 1);
          setRows(current => current.map(item => item.key === row.key ? {
            ...item, stage: "revealed", prospect: result.prospect || undefined,
            check: result.postRevealCheck || item.check, cachedReveal: Boolean(result.cached),
            creditUsed: Boolean(result.creditUsed), message: result.message,
          } : item));
        } catch (err) {
          setRows(current => current.map(item => item.key === row.key
            ? { ...item, stage: "error", error: err instanceof Error ? err.message : "Reveal failed." } : item));
        } finally { setProgress(value => ({ ...value, done: value.done + 1 })); }
      }
    });
    await Promise.all(workers);
    setSelected(new Set());
    setNotice("Reveal complete. Only people with a returned phone can move to HubSpot Push. No task has been created.");
    setBusy("");
  }

  async function pushSelected() {
    if (busy || !pushQueue.length) return;
    const when = new Date(dueDate + "T" + dueTime + ":00+03:00");
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) { setError("Choose a future time in Riyadh (UTC+3)."); return; }
    const companyKeys = new Set<string>();
    const queue = pushQueue.filter(row => {
      const key = (row.lead.companyDomain || row.lead.company).toLowerCase().trim();
      if (companyKeys.has(key)) return false;
      companyKeys.add(key); return true;
    });
    if (!window.confirm("Create " + queue.length + " phone-qualified contact(s) and CALL tasks in HubSpot? One per company. Ownership follows verified ATS. This action writes to the live CRM.")) return;
    setBusy("push"); setError(""); setProgress({ done: 0, total: queue.length });
    let created = 0;
    for (const row of queue) {
      try {
        const response = await fetch("/api/ai/lead-agent/push", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: row.runId, taskDueAt: when.toISOString(), lead: row.lead, prospect: row.prospect }),
        });
        const result = await responseJson<{ error?: string; taskId?: string; contactId?: string; duplicate?: boolean; aiSdrRoutedTo?: string }>(response);
        if (!response.ok) throw new Error(result.error || "CRM push failed.");
        if (!result.duplicate) { created++; setConfirmedPushes(value => value + 1); }
        setRows(current => current.map(item => item.key === row.key ? {
          ...item, stage: "pushed", message: (result.duplicate ? "Existing task preserved · " : "Created · ")
            + (result.aiSdrRoutedTo || "") + " · task " + (result.taskId || "pending verification"),
        } : item));
      } catch (err) {
        setRows(current => current.map(item => item.key === row.key
          ? { ...item, stage: "error", error: err instanceof Error ? err.message : "HubSpot push failed." } : item));
      } finally { setProgress(value => ({ ...value, done: value.done + 1 })); }
    }
    setSelected(new Set());
    setBusy("");
    setNotice("HubSpot push complete: " + created + " confirmed newly created task(s). Rejected/failed rows remain visible for review.");
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("ChatGPT instructions copied. Open ChatGPT, paste them and bring back the JSON results.");
      setError("");
    } catch { setError("Clipboard was blocked. Select and copy the visible prompt manually."); }
  }

  function prepareReviewPrompt() {
    const candidates = rows.filter(row => row.check).slice(0, AI_SDR_BATCH_LIMIT).map(row => ({
      name: row.lead.name, title: row.lead.title, company: row.lead.company,
      companyCountry: row.lead.companyCountry, employeeCount: row.lead.employeeCount,
      domain: row.lead.companyDomain, linkedinUrl: row.lead.linkedinUrl,
      crmStatus: assessment(row).status, needsReview: assessment(row).reason,
    }));
    setPrompt("Review the following public-prospect research for Saudi GTM. Cross-check company headcount, decision-maker job title and ATS evidence using authorized sources. Do not guess or invent. Return a corrected JSON object with a leads array compatible with the initial format, plus brief verification notes. CRM statuses are internal indicators, not invitations to disclose data.\n\n"
      + JSON.stringify(candidates, null, 2));
    setNotice("Prepared a ChatGPT review prompt from " + candidates.length + " prechecked people. Copy it using the button.");
  }

  return <main className={styles.page}>
    <div className={styles.container}>
      <header className={styles.topbar}>
        <Link className={styles.back} href="/"><ArrowLeft size={15}/>SDR Dashboard</Link>
        <span className={styles.pill}><ShieldCheck size={14}/>Admin only · review-first</span>
      </header>
      <div className={styles.hero}>
        <span className={styles.eyebrow}><Bot size={16}/>GTM OPERATIONS · SAUDI ARABIA</span>
        <h1>AI SDR Agent</h1>
        <p>Research with your ChatGPT account, load permitted Sales Navigator leads, check HubSpot for free, and approve any SignalHire credit use or CRM write separately.</p>
      </div>
      <div className={styles.stats}>
        <div><strong>{stats.total}</strong><span>In pilot queue</span></div>
        <div><strong>{checked}</strong><span>HubSpot checked</span></div>
        <div><strong>{stats.blocked}</strong><span>Blocked</span></div>
        <div><strong>{stats.review}</strong><span>Needs evidence</span></div>
        <div><strong>{stats.eligible}</strong><span>Eligible</span></div>
        <div><strong>{stats.phone}</strong><span>Phone-ready</span></div>
        <div><strong>{confirmedReveals}</strong><span>Reported new reveals</span></div>
        <div><strong>{confirmedPushes}</strong><span>Confirmed pushes</span></div>
      </div>
      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><span>01 · ChatGPT Companion</span><h2>Research without an AI API</h2></div><Sparkles size={20}/></div>
          <p>ChatGPT opens in your own account. The prompt is copied on request, not sent to an external endpoint by this dashboard.</p>
          <textarea className={styles.prompt} aria-label="ChatGPT research prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={6}/>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.primary} onClick={() => void copyPrompt()}><ClipboardCopy size={15}/>Copy prompt</button>
            <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" className={styles.secondary}>Open ChatGPT<ExternalLink size={14}/></a>
            <button type="button" className={styles.secondary} onClick={prepareReviewPrompt} disabled={!checked}>Prepare review brief</button>
          </div>
          <small>ChatGPT isn't embedded or silently logged in. This companion mode uses no paid OpenAI API and doesn't share CRM data automatically.</small>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><span>02 · Candidate intake</span><h2>Import vetted people</h2></div><Radar size={20}/></div>
          <p>Paste ChatGPT JSON results or load an existing authorized Sales Navigator batch. Both paths use the same CRM checks.</p>
          <textarea className={styles.import} aria-label="Paste JSON leads" placeholder='{"leads":[{"name":"...","title":"HR Director","company":"...","linkedinUrl":"https://www.linkedin.com/in/...","companyCountry":"Saudi Arabia","employeeCount":500}]}' rows={6} value={rawImport} onChange={event => setRawImport(event.target.value)}/>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.primary} onClick={importJson} disabled={Boolean(busy) || !rawImport.trim()}>Import JSON</button>
            <button type="button" className={styles.secondary} onClick={() => void loadSalesNav()} disabled={Boolean(busy)}>{busy === "source" ? <LoaderCircle className={styles.spin} size={14}/> : <Radar size={14}/>}Load saved Sales Nav batch</button>
            <Link href="/salesnav-prospecting" className={styles.textLink}>Source setup <ExternalLink size={13}/></Link>
          </div>
          <small>Up to {AI_SDR_BATCH_LIMIT} unique people per pilot. Imported ATS claims require human verification.</small>
        </section>
      </div>
      <section className={styles.panel}>
        <div className={styles.pipelineHead}>
          <div><span>03 · Controlled execution</span><h2>HubSpot qualification & approvals</h2><p>Saudi companies, 250+ employees, verified decision-maker, one pushed contact per company.</p></div>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.primary} disabled={Boolean(busy) || !rows.length} onClick={() => void runPrecheck()}>{busy === "check" ? <LoaderCircle className={styles.spin} size={15}/> : <SearchCheck size={15}/>}Free HubSpot precheck</button>
            <button type="button" className={styles.secondary} disabled={Boolean(busy) || !stats.eligible} onClick={() => selectEligible("reveal")}>Select to reveal</button>
            <button type="button" className={styles.secondary} disabled={Boolean(busy) || !stats.phone} onClick={() => selectEligible("push")}>Select phone-ready</button>
          </div>
        </div>
        <div className={styles.execution}>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.warning} onClick={() => void revealSelected()} disabled={Boolean(busy) || !revealQueue.length}><Phone size={15}/>Reveal selected ({revealQueue.length}) · may cost credits</button>
            <button type="button" className={styles.success} onClick={() => void pushSelected()} disabled={Boolean(busy) || !pushQueue.length}><Send size={15}/>Push + CALL tasks ({pushQueue.length})</button>
          </div>
          <div className={styles.due}>
            <label>Task date <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/></label>
            <label>Riyadh time <input type="time" value={dueTime} onChange={event => setDueTime(event.target.value)}/></label>
          </div>
        </div>
        {busy && busy !== "source" ? <div className={styles.progress} role="status"><LoaderCircle className={styles.spin} size={15}/>{busy}: {progress.done}/{progress.total}</div> : null}
        {notice ? <div className={styles.notice}><CheckCircle2 size={15}/>{notice}</div> : null}
        {error ? <div className={styles.error} role="alert"><CircleAlert size={16}/>{error}</div> : null}
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>Select</th><th>Person / company</th><th>Company evidence</th><th>ATS & SDR routing</th><th>CRM & action</th></tr></thead>
            <tbody>
              {rows.map(row => {
                const result = assessment(row);
                const canSelect = selectable(row);
                return <tr key={row.key}>
                  <td><input type="checkbox" aria-label={"Select " + row.lead.name} checked={selected.has(row.key)} disabled={Boolean(busy) || !canSelect} onChange={() => toggleSelected(row.key)}/></td>
                  <td className={styles.identity}><strong>{row.lead.name}</strong><span>{row.lead.title || "Title missing"}</span><b>{row.lead.company}</b><small>{row.lead.location || "Location unknown"}</small><a href={row.lead.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn profile <ExternalLink size={11}/></a></td>
                  <td className={styles.fields}>
                    <label>Country <input aria-label={"Company country for " + row.lead.name} value={row.lead.companyCountry} placeholder="Saudi Arabia" onChange={event => updateLead(row.key, { companyCountry: event.target.value })}/></label>
                    <label>Employees <input type="number" min={0} aria-label={"Headcount for " + row.lead.name} value={row.lead.employeeCount ?? ""} placeholder="250+" onChange={event => updateLead(row.key, { employeeCount: event.target.value ? Math.floor(Number(event.target.value)) : null })}/></label>
                    <label>Domain <input aria-label={"Company domain for " + row.lead.name} value={row.lead.companyDomain} placeholder="company.com" onChange={event => updateLead(row.key, { companyDomain: event.target.value })}/></label>
                  </td>
                  <td className={styles.fields}>
                    <span className={styles.hint}>HubSpot ATS: {row.check?.company.detectedAts || "not verified"}</span>
                    <select aria-label={"ATS verification for " + row.lead.name} value={row.lead.atsStatus} onChange={event => updateLead(row.key, { atsStatus: event.target.value as AiLead["atsStatus"] })}>
                      <option value="unknown">ATS unknown</option>
                      <option value="verified_with_ats">Verified ATS present</option>
                      <option value="verified_no_ats">Verified no ATS</option>
                    </select>
                    <input aria-label={"ATS evidence for " + row.lead.name} placeholder="Evidence URL / review notes" value={row.lead.atsEvidence} onChange={event => updateLead(row.key, { atsEvidence: event.target.value })}/>
                    <strong className={styles.route}>{result.ownerName || "Hold for review"}</strong>
                  </td>
                  <td className={styles.status}>
                    <span className={styles[result.status]}>{row.stage === "pushed" ? "Pushed" : result.status === "blocked" ? "Blocked" : result.status === "eligible" ? "Eligible" : "Review"}</span>
                    <span>{row.stage === "pending" ? "Not checked" : row.stage === "checking" ? "Checking HubSpot..." : row.stage === "revealing" ? "Revealing..." : row.message || result.reason}</span>
                    {hasVerifiedPhone(row) ? <b className={styles.phoneReady}><Phone size={12}/>Phone verified</b> : null}
                    {row.error ? <small className={styles.rowError}>{row.error}</small> : null}
                    {row.creditUsed ? <small>Reveal reported possible credit use</small> : row.cachedReveal ? <small>Cached reveal · zero new credits</small> : null}
                  </td>
                </tr>;
              })}
              {!rows.length ? <tr><td className={styles.empty} colSpan={5}>No candidates loaded yet. Generate a JSON shortlist in ChatGPT or import a saved Sales Navigator batch.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className={styles.footer}><ShieldCheck size={15}/>Every live push is rechecked server-side. No background LinkedIn scraping, automatic SignalHire reveals, or auto-push is enabled in this pilot.</footer>
      </section>
    </div>
  </main>;
}
