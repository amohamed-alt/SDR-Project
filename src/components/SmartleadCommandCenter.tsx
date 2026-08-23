"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, CircleAlert, Clock3, Database,
  KeyRound, Mail, Pause, Play, RefreshCw, Search, Send, ShieldCheck, Sparkles, UsersRound,
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

function savedOwnerToken() { if (typeof window === "undefined") return ""; return window.sessionStorage.getItem(OWNER_STORAGE_KEY) || ""; }
function number(value: number | undefined) { return new Intl.NumberFormat("en-US").format(value || 0); }
function percent(value: number | undefined) { return `${((value || 0) * 100).toFixed(1)}%`; }
function formatGeneratedAt(value: string | undefined) { if (!value) return "—"; try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return value; } }
function warmupLabel(sender: V2Sender) { if (!sender.warmupKnown) return "warmup status unavailable"; return sender.warmupEnabled ? "warmup on" : "warmup off"; }
function productLabel(product: OutreachProduct) { return product === "talentera" ? "Talentera" : "Evalufy"; }
function senderBrandLabel(brand: V2Sender["brand"]) { return brand === "unknown" ? "UNKNOWN" : productLabel(brand); }
function visibleCampaignName(value: string) { return value.replace(/Evalify/gi, "Evalufy"); }

export function SmartleadCommandCenter({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<SmartleadV2Payload | null>(null);
  const [autopilot, setAutopilot] = useState<AutopilotPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
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
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load Smartlead."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function saveOwnerToken() {
    const value = ownerTokenDraft.trim(); setOwnerToken(value);
    if (value) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value); else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
    setNotice(value ? "Owner PIN saved for this browser session." : "Owner PIN cleared.");
  }

  async function action(body: Record<string, unknown>, busyKey: string) {
    if (!ownerToken) { setError("Enter the Owner PIN first. Smartlead/OpenRouter/MillionVerifier secrets stay server-side."); return null; }
    setBusy(busyKey); setError(""); setNotice("");
    try {
      const response = await fetch("/api/smartlead", { method: "POST", headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken }, body: JSON.stringify(body) });
      const payload = await response.json() as Record<string, unknown> & { error?: string; details?: string };
      if (!response.ok) throw new Error(payload.details || payload.error || "Smartlead action failed.");
      await load(true); return payload;
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Smartlead action failed."); return null; }
    finally { setBusy(""); }
  }

  async function sendToday() {
    if (!ownerToken) { setError("Enter the Owner PIN once, save it for this browser session, then press Send today's batch."); return; }
    const today = data?.summary.today || data?.capacity.liveNewLeadsPerDay || 0;
    if (!today) { setError("There is no safe live capacity to send today."); return; }
    if (!window.confirm(`Run today's verified outreach for up to ${today} new leads? This will run Sales safety, language routing, MillionVerifier, SignalHire recovery, dedupe and Smartlead routing before anything is queued.`)) return;
    setBusy("send-today"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/smartlead/send-today", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken },
        body: JSON.stringify({ confirm: "SEND_VERIFIED_DAILY_BATCH" }),
      });
      const payload = await response.json() as Record<string, unknown> & { error?: string; details?: unknown; queued?: number; talentera?: number; evalufy?: number; skipped?: boolean; reason?: string };
      if (!response.ok) throw new Error(typeof payload.details === "string" ? payload.details : payload.error || "Verified daily send failed.");
      if (payload.skipped) setNotice(`Nothing new was queued: ${payload.reason || "today's safe batch was already processed"}.`);
      else setNotice(`Today's verified batch completed: ${String(payload.queued || 0)} queued · ${String(payload.talentera || 0)} Talentera · ${String(payload.evalufy || 0)} Evalufy.`);
      await load(true);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Verified daily send failed."); }
    finally { setBusy(""); }
  }

  async function bootstrap() {
    if (!window.confirm("Create/refresh the isolated Talentera + Evalufy V2 campaigns? This configures sequences but does NOT start sending.")) return;
    const result = await action({ action: "bootstrap" }, "bootstrap");
    if (result) setNotice("Both V2 campaigns are configured: fixed 3-touch, plain text, tracking off, stop on reply, Riyadh schedule. Nothing was started.");
  }
  async function syncSenders() {
    const result = await action({ action: "sync_senders" }, "senders");
    if (result) setNotice("Sender pools synced automatically by brand: Talentera inboxes → Talentera, Evalufy inboxes → Evalufy.");
  }
  async function analyzeNames() {
    const result = await action({ action: "analyze_names", limit: 150 }, "names");
    if (result) setNotice(`OpenRouter analyzed ${String(result.analyzed || 0)} GCC recipient names; ${String(result.arabic || 0)} resolved to high-confidence Arabic greetings.`);
  }
  async function prepare() {
    const cap = data?.capacity.liveNewLeadsPerDay || 0;
    if (!cap) { setError("No live sender capacity yet. Bootstrap + Sync senders first."); return; }
    const result = await action({ action: "prepare", limit: cap }, "prepare");
    if (result) setNotice(`Prepared ${String(result.prepared || 0)} leads: ${String(result.talentera || 0)} Talentera + ${String(result.evalify || 0)} Evalufy. No email was sent.`);
  }
  async function launch() {
    const prepared = data?.summary.prepared || 0; if (!prepared) { setError("Prepare today's batch first."); return; }
    if (!window.confirm(`Queue ${prepared} prepared contacts? Fresh Sales, dedupe, product, language and sender checks run again immediately before upload.`)) return;
    const result = await action({ action: "launch", confirm: "QUEUE_MARITA_BATCH" }, "launch");
    if (result) setNotice(`Queued ${String(result.queued || 0)} total: ${String(result.talentera || 0)} Talentera + ${String(result.evalify || 0)} Evalufy. ${String(result.skippedByFreshSafetyOrDedupe || 0)} skipped.`);
  }
  async function changeStatus(product: OutreachProduct | "all", status: "START" | "PAUSED") {
    const label = product === "all" ? "both V2 campaigns" : `${productLabel(product)} V2`;
    if (!window.confirm(`${status === "START" ? "Start/resume" : "Pause"} ${label}?`)) return;
    const result = await action({ action: "status", product, status, confirm: "CHANGE_CAMPAIGN_STATUS" }, `status:${product}:${status}`);
    if (result) setNotice(`${label} ${status === "START" ? "started under the current sender/reputation limits" : "paused"}.`);
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
  const tCampaign = data?.campaigns.talentera;
  const eCampaign = data?.campaigns.evalify;
  const autopilotHealthy = Boolean(autopilot?.enabled && !["blocked", "failed"].includes(autopilot.state.status));

  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/> SDR Dashboard</button>
      <div className={styles.title}><span><Mail size={15}/>SMARTLEAD OUTREACH V2</span><h1>Marita dual-product execution</h1><p>Daily autopilot · ATS-aware product routing · Arabic/English recipient intelligence · dedupe ledger · fixed sequences · Smartlead execution.</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""}/>{loading ? "Refreshing" : "Refresh"}</button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={16}/>{error}</div>}
    {notice && <div className={styles.success}><CheckCircle2 size={16}/>{notice}</div>}

    <section className={styles.statusRow}>
      <span data-ok={data?.configuration.apiConfigured}><Database size={14}/> Smartlead {data?.configuration.apiConfigured ? "connected" : "missing"}</span>
      <span data-ok={data?.configuration.openRouterConfigured}><Sparkles size={14}/> OpenRouter {data?.configuration.openRouterConfigured ? "ready" : "missing"}</span>
      <span data-ok={safetyHealthy}><ShieldCheck size={14}/> Sales safety {safetyHealthy ? "healthy" : "blocked"}</span>
      <span data-ok={autopilotHealthy}><Clock3 size={14}/> Autopilot {autopilot?.enabled ? autopilot.state.status.toUpperCase() : "OFF"}</span>
      <span data-ok={Boolean(tCampaign)}>Talentera {tCampaign?.status || "NOT CREATED"}</span>
      <span data-ok={Boolean(eCampaign)}>Evalufy {eCampaign?.status || "NOT CREATED"}</span>
      <small>Updated {formatGeneratedAt(data?.generatedAt)} Riyadh</small>
    </section>

    <section className={styles.healthGrid}>
      <article><strong>Daily autopilot</strong><span>{autopilot?.enabled ? "ON · Sunday-Thursday" : "Not active yet"}</span><small>Queue attempts {autopilot?.queueAttemptsRiyadh?.join(" · ") || "08:45 · 09:05 · 09:25"} Riyadh · first success wins</small></article>
      <article><strong>Last automatic run</strong><span>{autopilot?.state.status?.toUpperCase() || "NEVER"}</span><small>{autopilot?.state.finishedAt ? formatGeneratedAt(autopilot.state.finishedAt) : "No run recorded yet"} · {autopilot?.state.message || "Waiting for first scheduled run"}</small></article>
      <article><strong>Last queued</strong><span>{number(autopilot?.state.queued)} contacts</span><small>{number(autopilot?.state.talentera)} Talentera · {number(autopilot?.state.evalufy)} Evalufy · once entered, never re-entered</small></article>
      <article><strong>Smartlead send window</strong><span>{autopilot?.smartleadSendWindowRiyadh || "09:30-16:30"} Riyadh</span><small>Smartlead owns Day 0 → Day 3 → Day 7; stop on reply stays enabled</small></article>
    </section>

    {Boolean(autopilot?.state.warnings?.length) && <section className={styles.warningPanel}><ShieldCheck size={18}/><div><strong>Autopilot is fail-closed</strong><p>No automatic batch is queued while these checks are unresolved.</p>{autopilot?.state.warnings.map((warning) => <small key={warning}>{warning}</small>)}</div></section>}

    <section className={styles.metrics}>
      <article><BadgeCheck size={18}/><span>Ready</span><strong>{number(data?.summary.ready)}</strong><small>{number(data?.summary.talenteraReady)} Talentera · {number(data?.summary.evalifyReady)} Evalufy</small></article>
      <article><Send size={18}/><span>Today</span><strong>{number(data?.summary.today)}</strong><small>safe new leads across both products</small></article>
      <article><CalendarClock size={18}/><span>Tomorrow</span><strong>{number(data?.summary.tomorrow)}</strong><small>new leads available</small></article>
      <article><Clock3 size={18}/><span>Next 48h</span><strong>{number(data?.summary.next48Hours)}</strong><small>combined safe coverage</small></article>
      <article><Database size={18}/><span>Live capacity</span><strong>{number(data?.capacity.liveNewLeadsPerDay)}/day</strong><small>potential {number(data?.capacity.potentialNewLeadsPerDay)}/day · target {number(data?.configuration.globalDailyNewTarget)}</small></article>
      <article><UsersRound size={18}/><span>Entered before</span><strong>{number(data?.summary.alreadyEntered)}</strong><small>never re-enter the queue</small></article>
    </section>

    <section className={styles.executionPanel}>
      <div className={styles.executionIntro}>
        <div><strong>Send today</strong><p>One click runs the same verified engine as autopilot: Sales safety → language → MillionVerifier → SignalHire recovery → dedupe → product lane → Smartlead.</p></div>
        <div className={styles.ownerKey}><KeyRound size={15}/><input type="password" value={ownerTokenDraft} onChange={(event) => setOwnerTokenDraft(event.target.value)} placeholder="Owner PIN"/><button type="button" onClick={saveOwnerToken}>Save</button></div>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => void sendToday()} disabled={Boolean(busy) || !safetyHealthy || !data?.capacity.liveNewLeadsPerDay}><Send size={15}/>{busy === "send-today" ? "Verifying & queueing…" : `Send today's batch (${number(data?.summary.today)})`}</button>
        <button type="button" onClick={() => void bootstrap()} disabled={Boolean(busy)}><Database size={15}/>{busy === "bootstrap" ? "Configuring…" : "Bootstrap V2 campaigns"}</button>
        <button type="button" onClick={() => void syncSenders()} disabled={Boolean(busy) || !tCampaign || !eCampaign}><UsersRound size={15}/>{busy === "senders" ? "Syncing…" : "Sync sender pools"}</button>
        <button type="button" onClick={() => void analyzeNames()} disabled={Boolean(busy) || !data?.configuration.openRouterConfigured}><Sparkles size={15}/>{busy === "names" ? "Analyzing…" : "AI-analyze 150 names"}</button>
        <button type="button" onClick={() => void prepare()} disabled={Boolean(busy) || !safetyHealthy || !data?.capacity.liveNewLeadsPerDay}><Sparkles size={15}/>{busy === "prepare" ? "Preparing…" : "Prepare only"}</button>
        <button type="button" onClick={() => void launch()} disabled={Boolean(busy) || !data?.summary.prepared || !safetyHealthy}><Send size={15}/>{busy === "launch" ? "Safety checking…" : "Queue prepared only"}</button>
        <button type="button" onClick={() => void changeStatus("all", "START")} disabled={Boolean(busy) || !tCampaign || !eCampaign}><Play size={15}/>Start both</button>
        <button type="button" onClick={() => void changeStatus("all", "PAUSED")} disabled={Boolean(busy) || (!tCampaign && !eCampaign)}><Pause size={15}/>Pause both</button>
      </div>
    </section>

    {!safetyHealthy && <section className={styles.warningPanel}><ShieldCheck size={18}/><div><strong>Sending is locked</strong><p>Sales activity safety must be healthy before any batch can be queued.</p>{(data?.safety.warnings || []).map((warning) => <small key={warning}>{warning}</small>)}</div></section>}

    <section className={styles.healthGrid}>
      <article><strong>15-inbox capacity model</strong><span>{number(data?.capacity.liveCampaignEmailsPerDay)} live campaign emails/day</span><small>{number(data?.capacity.assignedInboxes)} assigned · {number(data?.capacity.eligibleInboxes)} eligible · max {number(data?.configuration.maxCampaignEmailsPerMailbox)}/mailbox · {number(data?.configuration.minTimeBetweenEmails)}m gap</small></article>
      <article><strong>Talentera route</strong><span>{number(data?.summary.talenteraReady)} ready · cap {number(data?.capacity.productLiveNewCaps.talentera)}/day</span><small>No verified ATS visible → sell Talentera ATS/recruitment workflow</small></article>
      <article><strong>Evalufy route</strong><span>{number(data?.summary.evalifyReady)} ready · cap {number(data?.capacity.productLiveNewCaps.evalify)}/day</span><small>Existing/custom ATS detected → sell assessments/screening without replacing ATS</small></article>
      <article><strong>Deliverability</strong><span>Talentera {percent(data?.analytics.talentera.bounceRate)} · Evalufy {percent(data?.analytics.evalify.bounceRate)} bounce</span><small>Plain text · open/click tracking off · stop on reply · global block/unsubscribe lists respected</small></article>
    </section>

    <section className={styles.sendersPanel}>
      <div className={styles.sectionHeader}><div><h2>Sender pools</h2><p>Automatic brand isolation. Evalufy addresses never send Talentera copy and vice versa.</p></div></div>
      <div className={styles.senderGrid}>
        {(data?.senders || []).map((sender) => <div key={sender.id} className={styles.senderCard} data-selected={sender.assignedProducts.includes(sender.brand as OutreachProduct)}>
          <span>{sender.eligible ? "✓" : "!"}</span><div><strong>{sender.email}</strong><small>{senderBrandLabel(sender.brand)} · {sender.assignedProducts.length ? `assigned ${sender.assignedProducts.map(productLabel).join(", ")}` : "not assigned"} · limit {sender.maxPerDay || "—"}/day · {warmupLabel(sender)}</small></div>
        </div>)}
      </div>
    </section>

    <section className={styles.previewPanel}>
      <div className={styles.sectionHeader}><div><h2>Sequence studio</h2><p>Fixed copy is the source of truth. OpenRouter only writes one safe contextual opening line; language routing itself is deterministic and cannot be changed by AI.</p></div></div>
      <div className={styles.previewGrid}>
        {(["talentera", "evalify"] as OutreachProduct[]).flatMap((product) => (["arSA", "en"] as const).map((language) => {
          const seq = data?.sequenceCatalog[product][language];
          const languageLabel = language === "arSA" ? "Saudi Arabic" : "English";
          return <article key={`${product}:${language}`}><strong>{productLabel(product)} · {languageLabel} · Day 0 → 3 → 7</strong><small>{product === "talentera" ? "No verified ATS" : "Existing ATS detected"}</small>
            <b>1. {visibleCampaignName(seq?.subject1 || "")}</b><p>{visibleCampaignName(seq?.touch1 || "")}</p><b>2. {visibleCampaignName(seq?.subject2 || "")}</b><p>{visibleCampaignName(seq?.touch2 || "")}</p><b>3. {visibleCampaignName(seq?.subject3 || "")}</b><p>{visibleCampaignName(seq?.touch3 || "")}</p>
          </article>;
        }))}
      </div>
    </section>

    {Boolean(data?.preparedSamples.length) && <section className={styles.previewPanel}>
      <div className={styles.sectionHeader}><div><h2>Prepared copy preview</h2><p>Final rendered copy after deterministic language routing and OpenRouter opening-line personalization.</p></div></div>
      <div className={styles.previewGrid}>{data?.preparedSamples.map((lead) => <article key={lead.contactId}><strong>{lead.greetingName} · {lead.companyName} · {productLabel(lead.product)}</strong><small>{lead.locale} · confidence {percent(lead.languageConfidence)} · {lead.languageReason}</small><b>{visibleCampaignName(lead.subject1)}</b><p>{visibleCampaignName(lead.touch1)}</p></article>)}</div>
    </section>}

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Marita email queue</h2><p>One contact/company. Anyone who ever entered a managed sequence is blocked from re-entry.</p></div><span>{number(filtered.length)} shown</span></div>
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
      <div className={styles.tableWrap}><table><thead><tr><th>Status</th><th>Contact</th><th>Company</th><th>Language routing</th><th>Product</th><th>ATS</th><th>Reason</th></tr></thead><tbody>
        {filtered.slice(0, 300).map((lead) => <tr key={`${lead.companyId}:${lead.contactId}`}>
          <td><span className={lead.eligible ? styles.ready : styles.blocked}>{lead.eligible ? "READY" : lead.executionStatus}</span></td>
          <td><strong>{lead.fullName}</strong><small>{lead.title}</small><small>{lead.email}</small></td>
          <td><strong>{lead.companyName}</strong><small>{lead.country}</small></td>
          <td><strong>{lead.locale} · {lead.greetingName || lead.firstName}</strong><small>{percent(lead.languageConfidence)} · {lead.nameTranslated ? "Arabic greeting" : "original name"}</small><small>{lead.languageReason}</small></td>
          <td><strong>{productLabel(lead.product)}</strong><small>{visibleCampaignName(lead.productReason)}</small></td>
          <td><strong>{lead.detectedAts || "No Visible ATS"}</strong><small>{lead.atsStatus || "—"}</small></td>
          <td><small>{lead.blockReason || `${lead.priority} · score ${lead.priorityScore}`}</small></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Execution ledger</h2><p>Smartlead status + persistent local ledger. Queued contacts remain excluded even after completion.</p></div><span>{number(data?.executions.length)} recent</span></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Contact</th><th>Product</th><th>Campaign</th><th>Status</th><th>Sequence step</th><th>Queued</th></tr></thead><tbody>
        {(data?.executions || []).slice(0, 250).map((row) => <tr key={`${row.email}:${row.campaignName}`}><td><strong>{row.email}</strong><small>{row.contactId || "—"}</small></td><td><strong>{productLabel(row.product)}</strong></td><td><small>{visibleCampaignName(row.campaignName)}</small></td><td><strong>{row.status}</strong></td><td>{row.sequenceStep || "—"}</td><td><small>{formatGeneratedAt(row.queuedAt)}</small></td></tr>)}
      </tbody></table></div>
    </section>
  </main>;
}
