"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BadgeCheck, CheckCircle2, CircleAlert, Clock3, KeyRound, Mail, RefreshCw, Search, Send, ShieldCheck } from "lucide-react";
import styles from "@/components/SmartleadCommandCenter.module.css";
import type { SmartleadV2Payload } from "@/lib/smartlead-v2";

const OWNER_STORAGE_KEY = "sdr-acquisition-owner-token";
type QueueFilter = "today" | "valid" | "recovery" | "waiting" | "entered" | "blocked" | "all";
type AutopilotPayload = {
  autopilotEnabled: boolean;
  campaigns: Record<string, string>;
  schedule: { sendWindow: string; businessDays: string; timezone: string; touch1: string; touch2: string; touch3: string };
  state: { status: string; finishedAt: string; queued: number; talentera: number; evalufy: number; message: string; warnings: string[] };
};

function savedOwnerToken() { return typeof window === "undefined" ? "" : window.sessionStorage.getItem(OWNER_STORAGE_KEY) || ""; }
function number(value: number | undefined) { return new Intl.NumberFormat("en-US").format(value || 0); }
function formatDate(value: string | undefined) { if (!value) return "—"; try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return value; } }
function verificationLabel(status: string) { return ({ valid: "MV valid today", invalid: "MV invalid today", catch_all: "Catch-all today", unknown: "Unknown today", stale: "Needs fresh check", error: "Check error", not_checked: "Not checked" } as Record<string, string>)[status] || status; }
function laneLabel(lane: string) { return ({ talentera_ar: "Talentera · Arabic", talentera_en: "Talentera · English", evalufy_ar: "Evalufy · Arabic", evalufy_en: "Evalufy · English" } as Record<string, string>)[lane] || lane; }

export function SmartleadCommandCenter({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<SmartleadV2Payload | null>(null);
  const [autopilot, setAutopilot] = useState<AutopilotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("today");
  const [ownerToken, setOwnerToken] = useState(savedOwnerToken);
  const [ownerTokenDraft, setOwnerTokenDraft] = useState(savedOwnerToken);

  const load = useCallback(async (force = false) => {
    setLoading(true); setError("");
    try {
      const [queueResponse, engineResponse] = await Promise.all([
        fetch(`/api/smartlead?view=full${force ? "&refresh=1" : ""}`, { cache: "no-store" }),
        fetch("/api/smartlead/orchestrator-v3", { cache: "no-store" }),
      ]);
      const queue = await queueResponse.json() as SmartleadV2Payload;
      if (!queueResponse.ok) throw new Error("Unable to load the outreach queue.");
      setData(queue);
      if (engineResponse.ok) setAutopilot(await engineResponse.json() as AutopilotPayload);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load Smartlead."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function saveOwnerToken() {
    const value = ownerTokenDraft.trim(); setOwnerToken(value);
    if (value) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value); else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
    setNotice(value ? "Owner PIN saved for this browser session." : "Owner PIN cleared.");
  }

  async function sendToday() {
    const today = data?.summary.today || 0;
    if (!ownerToken) { setError("Enter and save the Owner PIN first."); return; }
    if (!today) { setError("No candidates are currently in today's verification window."); return; }
    if (!window.confirm(`Verify up to ${today} candidates and queue only MillionVerifier-valid work emails into their exact campaign?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/smartlead/send-today", { method: "POST", headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken }, body: JSON.stringify({ confirm: "SEND_VERIFIED_DAILY_BATCH" }) });
      const payload = await response.json() as { error?: string; details?: unknown; skipped?: boolean; blocked?: boolean; reason?: string; state?: { queued?: number; talentera?: number; evalufy?: number }; verification?: { validCurrent?: number; replacements?: number; noValidEmail?: number; errors?: number } };
      if (!response.ok) throw new Error(typeof payload.details === "string" ? payload.details : payload.error || "Verified daily send failed.");
      if (payload.skipped || payload.blocked) setNotice(`Nothing was queued: ${payload.reason || "a safety gate stopped this run"}.`);
      else setNotice(`Completed: ${number(payload.state?.queued)} queued · ${number(payload.verification?.validCurrent)} current emails valid · ${number(payload.verification?.replacements)} SignalHire replacements · ${number(payload.verification?.noValidEmail)} skipped.`);
      await load(true);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Verified daily send failed."); }
    finally { setBusy(false); }
  }

  const counts = useMemo(() => {
    const queue = data?.queue || [];
    return {
      valid: queue.filter((lead) => lead.verification.status === "valid").length,
      waiting: queue.filter((lead) => ["not_checked", "stale", "unknown"].includes(lead.verification.status)).length,
      recovered: queue.filter((lead) => lead.verification.replacementUsed).length,
      recovery: queue.filter((lead) => lead.verification.signalHireAttempted && !lead.verification.replacementUsed).length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.queue || []).filter((lead) => {
      if (filter === "today" && lead.batchNumber !== 1) return false;
      if (filter === "valid" && lead.verification.status !== "valid") return false;
      if (filter === "recovery" && !lead.verification.signalHireAttempted) return false;
      if (filter === "waiting" && !["not_checked", "stale", "unknown"].includes(lead.verification.status)) return false;
      if (filter === "entered" && !/Already entered/i.test(lead.blockReason)) return false;
      if (filter === "blocked" && lead.eligible) return false;
      if (!query) return true;
      return [lead.fullName, lead.email, lead.companyName, lead.campaignName, lead.lane, lead.blockReason, lead.verification.reason].join(" ").toLowerCase().includes(query);
    });
  }, [data, filter, search]);

  const safetyHealthy = Boolean(data?.safety.healthy);
  const engineHealthy = Boolean(autopilot?.autopilotEnabled && !["blocked", "failed"].includes(autopilot.state.status));

  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/> Dashboard</button>
      <div className={styles.title}><span><Mail size={15}/>VERIFIED OUTREACH</span><h1>Today&apos;s Smartlead queue</h1><p>See who is next, their MillionVerifier result, any SignalHire replacement, and the exact campaign destination.</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""}/>{loading ? "Refreshing" : "Refresh"}</button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={16}/>{error}</div>}
    {notice && <div className={styles.success}><CheckCircle2 size={16}/>{notice}</div>}

    <section className={styles.statusRow}>
      <span data-ok={safetyHealthy}><ShieldCheck size={14}/> Safety {safetyHealthy ? "healthy" : "blocked"}</span>
      <span data-ok={engineHealthy}><Clock3 size={14}/> Autopilot {autopilot?.autopilotEnabled ? autopilot.state.status.toUpperCase() : "OFF"}</span>
      <span data-ok={data?.configuration.apiConfigured}>15 inbox routing</span>
      <small>Updated {formatDate(data?.generatedAt)} Riyadh</small>
    </section>

    {Boolean(data?.safety.warnings.length || autopilot?.state.warnings.length) && <section className={styles.warningPanel}><ShieldCheck size={18}/><div><strong>Sending is fail-closed</strong>{[...(data?.safety.warnings || []), ...(autopilot?.state.warnings || [])].map((warning) => <small key={warning}>{warning}</small>)}</div></section>}

    <section className={styles.metrics}>
      <article><Send size={18}/><span>On deck today</span><strong>{number(data?.summary.today)}</strong><small>maximum across the 4 lanes</small></article>
      <article><BadgeCheck size={18}/><span>MV valid today</span><strong>{number(counts.valid)}</strong><small>send gate still runs a fresh live check</small></article>
      <article><Clock3 size={18}/><span>Waiting check</span><strong>{number(counts.waiting)}</strong><small>checked only when their batch runs</small></article>
      <article><CheckCircle2 size={18}/><span>Recovered</span><strong>{number(counts.recovered)}</strong><small>SignalHire + MV valid replacement</small></article>
    </section>

    <section className={styles.executionPanel}>
      <div className={styles.executionIntro}><div><strong>Start today&apos;s verified batch</strong><p>Fresh MillionVerifier check → exact LinkedIn and current employer match when recovery is needed → work email only → HubSpot status update → final dedupe → exact campaign.</p></div><div className={styles.ownerKey}><KeyRound size={15}/><input type="password" value={ownerTokenDraft} onChange={(event) => setOwnerTokenDraft(event.target.value)} placeholder="Owner PIN"/><button type="button" onClick={saveOwnerToken}>Save</button></div></div>
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => void sendToday()} disabled={busy || !safetyHealthy || !data?.summary.today}><Send size={15}/>{busy ? "Verifying & queueing…" : `Run verified batch (${number(data?.summary.today)})`}</button><small>Nothing enters Smartlead on catch-all, invalid, unknown, personal email, LinkedIn mismatch, employer mismatch, Sales activity, or duplicate.</small></div>
    </section>

    <section className={styles.healthGrid}>
      <article><strong>Talentera · Arabic</strong><span>15 new/day</span><small>No verified ATS · Arabic-safe name</small></article>
      <article><strong>Talentera · English</strong><span>15 new/day</span><small>No verified ATS · English fallback</small></article>
      <article><strong>Evalufy · Arabic</strong><span>10 new/day</span><small>Existing ATS · Arabic-safe name</small></article>
      <article><strong>Evalufy · English</strong><span>10 new/day</span><small>Existing ATS · English fallback</small></article>
    </section>

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Verification order</h2><p>Batch and lane positions show exactly who is next and where they will go.</p></div><span>{number(filtered.length)} shown</span></div>
      <div className={styles.filters}><div>{(["today", "valid", "recovery", "waiting", "entered", "blocked", "all"] as QueueFilter[]).map((item) => <button key={item} type="button" data-active={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div><label><Search size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search person, company or campaign…"/></label></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Order</th><th>Person</th><th>MillionVerifier</th><th>SignalHire</th><th>Destination</th><th>Safety</th></tr></thead><tbody>
        {filtered.slice(0, 400).map((lead) => <tr key={`${lead.companyId}:${lead.contactId}`}>
          <td><strong>{lead.batchLabel}</strong><small>{lead.lanePosition ? `#${lead.lanePosition} in lane` : "not queued"}</small></td>
          <td><strong>{lead.fullName || "Unnamed contact"}</strong><small>{lead.email || "No current email"}</small><small>{lead.companyName}</small></td>
          <td><span className={lead.verification.status === "valid" ? styles.ready : styles.blocked}>{verificationLabel(lead.verification.status)}</span><small>{lead.verification.checkedAt ? formatDate(lead.verification.checkedAt) : "Runs at send gate"}</small></td>
          <td><strong>{lead.verification.replacementUsed ? "Replacement valid" : lead.verification.signalHireAttempted ? "Checked · no safe replacement" : "Not needed yet"}</strong><small>{lead.verification.reason}</small></td>
          <td><strong>{laneLabel(lead.lane)}</strong><small>{lead.campaignName}</small></td>
          <td><span className={lead.eligible ? styles.ready : styles.blocked}>{lead.eligible ? "READY FOR GATE" : lead.executionStatus}</span><small>{lead.blockReason || `${lead.priority} · score ${lead.priorityScore}`}</small></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <details className={styles.details}><summary>Operational details</summary><div className={styles.healthGrid}><article><strong>Schedule</strong><span>{autopilot?.schedule.sendWindow || "09:30-16:30"} Riyadh</span><small>Sunday-Thursday · Day 1, +4, +6</small></article><article><strong>Last run</strong><span>{autopilot?.state.status?.toUpperCase() || "NEVER"} · {number(autopilot?.state.queued)} queued</span><small>{autopilot?.state.message || "No run yet"}</small></article><article><strong>Execution ledger</strong><span>{number(data?.executions.length)} visible entries</span><small>Queued contacts are never re-entered.</small></article><article><strong>Recovery failures</strong><span>{number(counts.recovery)}</span><small>Remain skipped; the rest of the batch continues.</small></article></div></details>
  </main>;
}
