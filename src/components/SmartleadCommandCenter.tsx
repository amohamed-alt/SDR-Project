"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, CircleAlert, Clock3, Database,
  KeyRound, Mail, RefreshCw, Search, Send, ShieldCheck, Sparkles, UsersRound,
} from "lucide-react";
import styles from "@/components/SmartleadCommandCenter.module.css";
import type { SmartleadV2Payload, V2Sender } from "@/lib/smartlead-v2";
import type { OutreachProduct } from "@/lib/recipient-language-routing";

const OWNER_STORAGE_KEY = "sdr-acquisition-owner-token";
type QueueFilter = "ready" | "blocked" | "all" | "talentera" | "evalify" | "entered";
type AutopilotPayload = {
  enabled: boolean;
  timezone: string;
  businessDays: string;
  queueAttemptsRiyadh: string[];
  smartleadSendWindowRiyadh: string;
  starterDailyNewLeadTarget: number;
  state: {
    status: string;
    riyadhDate: string;
    startedAt: string;
    finishedAt: string;
    lastSuccessfulDate: string;
    prepared: number;
    queued: number;
    talentera: number;
    evalufy: number;
    message: string;
    warnings: string[];
  };
};

type SendResult = {
  error?: string;
  details?: unknown;
  queued?: number;
  talentera?: number;
  evalufy?: number;
  skipped?: boolean;
  blocked?: boolean;
  reason?: string;
  state?: { queued?: number; talentera?: number; evalufy?: number; message?: string };
};

function savedOwnerToken() { if (typeof window === "undefined") return ""; return window.sessionStorage.getItem(OWNER_STORAGE_KEY) || ""; }
function number(value: number | undefined) { return new Intl.NumberFormat("en-US").format(value || 0); }
function percent(value: number | undefined) { return `${((value || 0) * 100).toFixed(1)}%`; }
function formatGeneratedAt(value: string | undefined) { if (!value) return "—"; try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return value; } }
function warmupLabel(sender: V2Sender) { if (!sender.warmupKnown) return "warmup status unavailable"; return sender.warmupEnabled ? "warmup on" : "warmup off"; }
function productLabel(product: OutreachProduct) { return product === "talentera" ? "Talentera" : "Evalufy"; }
function senderBrandLabel(brand: V2Sender["brand"]) { return brand === "unknown" ? "UNKNOWN" : productLabel(brand); }
function visible(value: string) { return value.replace(/Evalify/gi, "Evalufy"); }

export function SmartleadCommandCenter({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<SmartleadV2Payload | null>(null);
  const [autopilot, setAutopilot] = useState<AutopilotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("ready");
  const [ownerToken, setOwnerToken] = useState(savedOwnerToken);
  const [ownerTokenDraft, setOwnerTokenDraft] = useState(savedOwnerToken);

  const load = useCallback(async (force = false) => {
    setLoading(true); setError("");
    try {
      const [smartleadResponse, autopilotResponse] = await Promise.all([
        fetch(`/api/smartlead${force ? "?refresh=1" : ""}`, { cache: "no-store" }),
        fetch("/api/smartlead/autopilot", { cache: "no-store" }).catch(() => null),
      ]);
      const payload = await smartleadResponse.json() as SmartleadV2Payload & { error?: string; details?: string };
      if (!smartleadResponse.ok) throw new Error(payload.details || payload.error || "Unable to load Smartlead.");
      setData(payload);
      if (autopilotResponse?.ok) setAutopilot(await autopilotResponse.json() as AutopilotPayload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Smartlead.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function saveOwnerToken() {
    const value = ownerTokenDraft.trim(); setOwnerToken(value);
    if (value) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value); else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
    setNotice(value ? "Owner PIN saved for this browser session." : "Owner PIN cleared.");
  }

  async function sendToday() {
    if (!ownerToken) { setError("Enter the Owner PIN once, save it, then press Send today's batch."); return; }
    const today = data?.summary.today || 0;
    if (!today) { setError("There is no safe live capacity to queue right now. Refresh to see the current reason."); return; }
    if (!data?.safety.healthy) { setError("Sales safety is not healthy, so sending is locked."); return; }
    if (!window.confirm(`Run the verified outreach engine for up to ${today} new leads today? It will verify email, recover invalid emails when possible, re-check Sales safety and route each lead to the correct product/language campaign.`)) return;

    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/smartlead/send-today", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken },
        body: JSON.stringify({ confirm: "SEND_VERIFIED_DAILY_BATCH" }),
      });
      const result = await response.json() as SendResult;
      if (!response.ok) throw new Error(typeof result.details === "string" ? result.details : result.error || "Verified daily send failed.");
      const queued = result.queued ?? result.state?.queued ?? 0;
      const talentera = result.talentera ?? result.state?.talentera ?? 0;
      const evalufy = result.evalufy ?? result.state?.evalufy ?? 0;
      if (result.blocked) setNotice(`Nothing was queued: ${result.state?.message || result.reason || "a safety guard blocked the run"}.`);
      else if (result.skipped) setNotice(`Nothing new was queued: ${result.reason || "today's batch was already processed"}.`);
      else setNotice(`Verified batch complete: ${queued} queued · ${talentera} Talentera · ${evalufy} Evalufy. Smartlead now owns the Day 0 / Day 3 / Day 7 sequence.`);
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Verified daily send failed.");
    } finally { setBusy(false); }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.queue || []).filter((lead) => {
      if (filter === "ready" && !lead.eligible) return false;
      if (filter === "blocked" && lead.eligible) return false;
      if (filter === "talentera" && lead.product !== "talentera") return false;
      if (filter === "evalify" && lead.product !== "evalify") return false;
      if (filter === "entered" && !/Already entered/i.test(lead.blockReason)) return false;
      if (!query) return true;
      return [lead.fullName, lead.greetingName, lead.email, lead.companyName, lead.country, lead.industry, lead.persona, lead.detectedAts, lead.product, lead.executionStatus, lead.blockReason].join(" ").toLowerCase().includes(query);
    });
  }, [data, filter, search]);

  const safetyHealthy = Boolean(data?.safety.healthy);
  const autopilotHealthy = Boolean(autopilot?.enabled && !["blocked", "failed"].includes(autopilot.state.status));

  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/> SDR Dashboard</button>
      <div className={styles.title}>
        <span><Mail size={15}/>SMARTLEAD COMMAND CENTER</span>
        <h1>One engine · four language/product lanes</h1>
        <p>Talentera Arabic/English + Evalufy Arabic/English. The dashboard verifies and routes; Smartlead sends and follows up.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""}/>{loading ? "Refreshing" : "Refresh"}</button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={16}/>{error}</div>}
    {notice && <div className={styles.success}><CheckCircle2 size={16}/>{notice}</div>}

    <section className={styles.statusRow}>
      <span data-ok={data?.configuration.apiConfigured}><Database size={14}/> Smartlead {data?.configuration.apiConfigured ? "connected" : "missing"}</span>
      <span data-ok={data?.configuration.openRouterConfigured}><Sparkles size={14}/> OpenRouter {data?.configuration.openRouterConfigured ? "opening-line ready" : "missing"}</span>
      <span data-ok={safetyHealthy}><ShieldCheck size={14}/> Sales safety {safetyHealthy ? "healthy" : "locked"}</span>
      <span data-ok={autopilotHealthy}><Clock3 size={14}/> Autopilot {autopilot?.enabled ? autopilot.state.status.toUpperCase() : "OFF"}</span>
      <small>Updated {formatGeneratedAt(data?.generatedAt)} Riyadh</small>
    </section>

    <section className={styles.healthGrid}>
      <article><strong>Daily autopilot</strong><span>{autopilot?.enabled ? "ON · Sunday-Thursday" : "Not active"}</span><small>Attempts {autopilot?.queueAttemptsRiyadh?.join(" · ") || "08:45 · 09:05 · 09:25"} Riyadh · first successful run wins</small></article>
      <article><strong>Last automatic run</strong><span>{autopilot?.state.status?.toUpperCase() || "NEVER"}</span><small>{autopilot?.state.finishedAt ? formatGeneratedAt(autopilot.state.finishedAt) : "No run recorded yet"} · {autopilot?.state.message || "Waiting"}</small></article>
      <article><strong>Last queued</strong><span>{number(autopilot?.state.queued)} contacts</span><small>{number(autopilot?.state.talentera)} Talentera · {number(autopilot?.state.evalufy)} Evalufy · entered leads never re-enter</small></article>
      <article><strong>Smartlead send window</strong><span>{autopilot?.smartleadSendWindowRiyadh || "09:30-16:30"} Riyadh</span><small>Touch 1 Day 0 · Touch 2 Day 3 · Touch 3 Day 7 · stop on reply</small></article>
    </section>

    <section className={styles.metrics}>
      <article><BadgeCheck size={18}/><span>Ready</span><strong>{number(data?.summary.ready)}</strong><small>{number(data?.summary.talenteraReady)} Talentera · {number(data?.summary.evalifyReady)} Evalufy</small></article>
      <article><Send size={18}/><span>Today</span><strong>{number(data?.summary.today)}</strong><small>maximum verified new leads now</small></article>
      <article><CalendarClock size={18}/><span>Tomorrow</span><strong>{number(data?.summary.tomorrow)}</strong><small>next safe batch available</small></article>
      <article><Clock3 size={18}/><span>Next 48h</span><strong>{number(data?.summary.next48Hours)}</strong><small>safe new-lead coverage</small></article>
      <article><Database size={18}/><span>Live capacity</span><strong>{number(data?.capacity.liveNewLeadsPerDay)}/day</strong><small>{number(data?.capacity.assignedInboxes)} assigned inboxes · target {number(data?.configuration.globalDailyNewTarget)}</small></article>
      <article><UsersRound size={18}/><span>Entered before</span><strong>{number(data?.summary.alreadyEntered)}</strong><small>blocked from re-entry permanently</small></article>
    </section>

    <section className={styles.executionPanel}>
      <div className={styles.executionIntro}>
        <div><strong>Send today&apos;s verified batch</strong><p>One action only: Sales safety → deterministic language → MillionVerifier → SignalHire recovery → HubSpot refresh → dedupe → Talentera/Evalufy lane → Smartlead.</p></div>
        <div className={styles.ownerKey}><KeyRound size={15}/><input type="password" value={ownerTokenDraft} onChange={(event) => setOwnerTokenDraft(event.target.value)} placeholder="Owner PIN"/><button type="button" onClick={saveOwnerToken}>Save</button></div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => void sendToday()} disabled={busy || !safetyHealthy || !data?.summary.today}><Send size={15}/>{busy ? "Verifying & queueing…" : `Send today's batch (${number(data?.summary.today)})`}</button>
      </div>
      <small>Campaign setup, sender routing and parity are maintained automatically after deployment. The old manual campaign engine is retired.</small>
    </section>

    {!safetyHealthy && <section className={styles.warningPanel}><ShieldCheck size={18}/><div><strong>Sending is locked</strong><p>The live HubSpot Sales safety scan must be healthy before any real lead can enter Smartlead.</p>{(data?.safety.warnings || []).map((warning) => <small key={warning}>{warning}</small>)}</div></section>}
    {Boolean(autopilot?.state.warnings?.length) && <section className={styles.warningPanel}><ShieldCheck size={18}/><div><strong>Autopilot guard</strong>{autopilot?.state.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div></section>}

    <section className={styles.healthGrid}>
      <article><strong>Sender capacity</strong><span>{number(data?.capacity.liveCampaignEmailsPerDay)} campaign emails/day</span><small>{number(data?.capacity.assignedInboxes)} assigned · {number(data?.capacity.eligibleInboxes)} eligible · max {number(data?.configuration.maxCampaignEmailsPerMailbox)}/mailbox · {number(data?.configuration.minTimeBetweenEmails)}m gap</small></article>
      <article><strong>Talentera route</strong><span>{number(data?.summary.talenteraReady)} ready · cap {number(data?.capacity.productLiveNewCaps.talentera)}/day</span><small>No verified ATS visible → Talentera</small></article>
      <article><strong>Evalufy route</strong><span>{number(data?.summary.evalifyReady)} ready · cap {number(data?.capacity.productLiveNewCaps.evalify)}/day</span><small>Existing/custom ATS → Evalufy assessment & screening</small></article>
      <article><strong>Deliverability</strong><span>Talentera {percent(data?.analytics.talentera.bounceRate)} · Evalufy {percent(data?.analytics.evalify.bounceRate)} bounce</span><small>Plain text · tracking off · stop on reply · block/unsubscribe lists respected</small></article>
    </section>

    <section className={styles.sendersPanel}>
      <div className={styles.sectionHeader}><div><h2>Live sender pools</h2><p>Brand isolation comes from the four real Smartlead campaigns. Arabic and English lanes share the same brand pool without double-counting capacity.</p></div></div>
      <div className={styles.senderGrid}>
        {(data?.senders || []).map((sender) => <div key={sender.id} className={styles.senderCard} data-selected={sender.assignedProducts.length > 0}>
          <span>{sender.eligible && sender.assignedProducts.length ? "✓" : "!"}</span><div><strong>{sender.email}</strong><small>{senderBrandLabel(sender.brand)} · {sender.assignedProducts.length ? `assigned ${sender.assignedProducts.map(productLabel).join(", ")}` : "not assigned"} · limit {sender.maxPerDay || "—"}/day · {warmupLabel(sender)}</small></div>
        </div>)}
      </div>
    </section>

    <section className={styles.previewPanel}>
      <div className={styles.sectionHeader}><div><h2>Exact Smartlead sequences</h2><p>These are the canonical templates synced to Smartlead. OpenRouter may only supply the opening line; it cannot change recipient language or greeting.</p></div></div>
      <div className={styles.previewGrid}>
        {(["talentera", "evalify"] as OutreachProduct[]).flatMap((product) => (["arSA", "en"] as const).map((language) => {
          const seq = data?.sequenceCatalog[product][language];
          return <article key={`${product}:${language}`}><strong>{productLabel(product)} · {language === "arSA" ? "Saudi Arabic" : "English"} · Day 0 → 3 → 7</strong><small>{product === "talentera" ? "No verified ATS" : "Existing ATS"}</small>
            <b>Touch 1 · {visible(seq?.subject1 || "")}</b><p>{visible(seq?.touch1 || "")}</p>
            <b>Touch 2 · same thread</b><p>{visible(seq?.touch2 || "")}</p>
            <b>Touch 3 · same thread</b><p>{visible(seq?.touch3 || "")}</p>
          </article>;
        }))}
      </div>
    </section>

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Verified routing queue</h2><p>Language shown here is deterministic. John/Priya/Sarah cannot be switched to Arabic by OpenRouter.</p></div><span>{number(filtered.length)} shown</span></div>
      <div className={styles.filters}>
        <div>
          <button type="button" data-active={filter === "ready"} onClick={() => setFilter("ready")}>Ready</button>
          <button type="button" data-active={filter === "talentera"} onClick={() => setFilter("talentera")}>Talentera</button>
          <button type="button" data-active={filter === "evalify"} onClick={() => setFilter("evalify")}>Evalufy</button>
          <button type="button" data-active={filter === "entered"} onClick={() => setFilter("entered")}>Already entered</button>
          <button type="button" data-active={filter === "blocked"} onClick={() => setFilter("blocked")}>Blocked</button>
          <button type="button" data-active={filter === "all"} onClick={() => setFilter("all")}>All</button>
        </div>
        <label><Search size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, person, product, country, ATS…"/></label>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Status</th><th>Contact</th><th>Company</th><th>Language</th><th>Product</th><th>ATS</th><th>Reason</th></tr></thead><tbody>
        {filtered.slice(0, 300).map((lead) => <tr key={`${lead.companyId}:${lead.contactId}`}>
          <td><span className={lead.eligible ? styles.ready : styles.blocked}>{lead.eligible ? "READY" : lead.executionStatus}</span></td>
          <td><strong>{lead.fullName}</strong><small>{lead.title}</small><small>{lead.email}</small></td>
          <td><strong>{lead.companyName}</strong><small>{lead.country}</small></td>
          <td><strong>{lead.locale} · {lead.greetingName || lead.firstName}</strong><small>{percent(lead.languageConfidence)} · {lead.nameTranslated ? "Arabic greeting" : "original name"}</small><small>{lead.languageReason}</small></td>
          <td><strong>{productLabel(lead.product)}</strong><small>{visible(lead.productReason)}</small></td>
          <td><strong>{lead.detectedAts || "No Visible ATS"}</strong><small>{lead.atsStatus || "—"}</small></td>
          <td><small>{lead.blockReason || `${lead.priority} · score ${lead.priorityScore}`}</small></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Execution ledger</h2><p>Once queued, a contact remains excluded even after the sequence completes.</p></div><span>{number(data?.executions.length)} recent</span></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Contact</th><th>Product</th><th>Campaign</th><th>Status</th><th>Step</th><th>Queued</th></tr></thead><tbody>
        {(data?.executions || []).slice(0, 250).map((row) => <tr key={`${row.email}:${row.campaignName}`}><td><strong>{row.email}</strong><small>{row.contactId || "—"}</small></td><td><strong>{productLabel(row.product)}</strong></td><td><small>{visible(row.campaignName)}</small></td><td><strong>{row.status}</strong></td><td>{row.sequenceStep || "—"}</td><td><small>{formatGeneratedAt(row.queuedAt)}</small></td></tr>)}
      </tbody></table></div>
    </section>
  </main>;
}
