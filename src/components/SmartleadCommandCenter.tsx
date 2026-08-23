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

function savedOwnerToken() { if (typeof window === "undefined") return ""; return window.sessionStorage.getItem(OWNER_STORAGE_KEY) || ""; }
function number(value: number | undefined) { return new Intl.NumberFormat("en-US").format(value || 0); }
function percent(value: number | undefined) { return `${((value || 0) * 100).toFixed(1)}%`; }
function formatGeneratedAt(value: string | undefined) { if (!value) return "—"; try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return value; } }
function warmupLabel(sender: V2Sender) { if (!sender.warmupKnown) return "warmup status unavailable"; return sender.warmupEnabled ? "warmup on" : "warmup off"; }
function productLabel(product: OutreachProduct) { return product === "talentera" ? "Talentera" : "Evalify"; }

export function SmartleadCommandCenter({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<SmartleadV2Payload | null>(null);
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
      const response = await fetch(`/api/smartlead${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const payload = await response.json() as SmartleadV2Payload & { error?: string; details?: string };
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load Smartlead.");
      setData(payload);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load Smartlead."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function saveOwnerToken() {
    const value = ownerTokenDraft.trim(); setOwnerToken(value);
    if (value) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value); else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
    setNotice(value ? "Owner key saved for this browser session." : "Owner key cleared.");
  }

  async function action(body: Record<string, unknown>, busyKey: string) {
    if (!ownerToken) { setError("Enter the Owner key first. Smartlead/OpenRouter secrets stay server-side."); return null; }
    setBusy(busyKey); setError(""); setNotice("");
    try {
      const response = await fetch("/api/smartlead", { method: "POST", headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken }, body: JSON.stringify(body) });
      const payload = await response.json() as Record<string, unknown> & { error?: string; details?: string };
      if (!response.ok) throw new Error(payload.details || payload.error || "Smartlead action failed.");
      await load(true); return payload;
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Smartlead action failed."); return null; }
    finally { setBusy(""); }
  }

  async function bootstrap() {
    if (!window.confirm("Create/refresh the isolated Talentera + Evalify V2 campaigns? This configures sequences but does NOT start sending.")) return;
    const result = await action({ action: "bootstrap" }, "bootstrap");
    if (result) setNotice("Both V2 campaigns are configured: fixed 3-touch, plain text, tracking off, stop on reply, Riyadh schedule. Nothing was started.");
  }
  async function syncSenders() {
    const result = await action({ action: "sync_senders" }, "senders");
    if (result) setNotice("Sender pools synced automatically by brand: Talentera inboxes → Talentera, Evalify inboxes → Evalify.");
  }
  async function analyzeNames() {
    const result = await action({ action: "analyze_names", limit: 150 }, "names");
    if (result) setNotice(`OpenRouter analyzed ${String(result.analyzed || 0)} GCC recipient names; ${String(result.arabic || 0)} resolved to high-confidence Arabic greetings.`);
  }
  async function prepare() {
    const cap = data?.capacity.liveNewLeadsPerDay || 0;
    if (!cap) { setError("No live sender capacity yet. Bootstrap + Sync senders first."); return; }
    const result = await action({ action: "prepare", limit: cap }, "prepare");
    if (result) setNotice(`Prepared ${String(result.prepared || 0)} leads: ${String(result.talentera || 0)} Talentera + ${String(result.evalify || 0)} Evalify. No email was sent.`);
  }
  async function launch() {
    const prepared = data?.summary.prepared || 0; if (!prepared) { setError("Prepare today's batch first."); return; }
    if (!window.confirm(`Queue ${prepared} prepared contacts? Fresh Sales, dedupe, product, language and sender checks run again immediately before upload.`)) return;
    const result = await action({ action: "launch", confirm: "QUEUE_MARITA_BATCH" }, "launch");
    if (result) setNotice(`Queued ${String(result.queued || 0)} total: ${String(result.talentera || 0)} Talentera + ${String(result.evalify || 0)} Evalify. ${String(result.skippedByFreshSafetyOrDedupe || 0)} skipped.`);
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

  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/> SDR Dashboard</button>
      <div className={styles.title}><span><Mail size={15}/>SMARTLEAD OUTREACH V2</span><h1>Marita dual-product execution</h1><p>ATS-aware product routing · Arabic/English recipient intelligence · dedupe ledger · fixed sequences · Smartlead execution.</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""}/>{loading ? "Refreshing" : "Refresh"}</button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={16}/>{error}</div>}
    {notice && <div className={styles.success}><CheckCircle2 size={16}/>{notice}</div>}

    <section className={styles.statusRow}>
      <span data-ok={data?.configuration.apiConfigured}><Database size={14}/> Smartlead {data?.configuration.apiConfigured ? "connected" : "missing"}</span>
      <span data-ok={data?.configuration.openRouterConfigured}><Sparkles size={14}/> OpenRouter {data?.configuration.openRouterConfigured ? "ready" : "missing"}</span>
      <span data-ok={safetyHealthy}><ShieldCheck size={14}/> Sales safety {safetyHealthy ? "healthy" : "blocked"}</span>
      <span data-ok={Boolean(tCampaign)}>Talentera {tCampaign?.status || "NOT CREATED"}</span>
      <span data-ok={Boolean(eCampaign)}>Evalify {eCampaign?.status || "NOT CREATED"}</span>
      <small>Updated {formatGeneratedAt(data?.generatedAt)} Riyadh</small>
    </section>

    <section className={styles.metrics}>
      <article><BadgeCheck size={18}/><span>Ready</span><strong>{number(data?.summary.ready)}</strong><small>{number(data?.summary.talenteraReady)} Talentera · {number(data?.summary.evalifyReady)} Evalify</small></article>
      <article><Send size={18}/><span>Today</span><strong>{number(data?.summary.today)}</strong><small>safe new leads across both products</small></article>
      <article><CalendarClock size={18}/><span>Tomorrow</span><strong>{number(data?.summary.tomorrow)}</strong><small>new leads available</small></article>
      <article><Clock3 size={18}/><span>Next 48h</span><strong>{number(data?.summary.next48Hours)}</strong><small>combined safe coverage</small></article>
      <article><Database size={18}/><span>Live capacity</span><strong>{number(data?.capacity.liveNewLeadsPerDay)}/day</strong><small>potential {number(data?.capacity.potentialNewLeadsPerDay)}/day · target {number(data?.configuration.globalDailyNewTarget)}</small></article>
      <article><UsersRound size={18}/><span>Entered before</span><strong>{number(data?.summary.alreadyEntered)}</strong><small>never re-enter the queue</small></article>
    </section>

    <section className={styles.executionPanel}>
      <div className={styles.executionIntro}>
        <div><strong>Execution controls</strong><p>Recommended order: Bootstrap → Sync senders → AI name QA → Prepare → review copy → Queue → Start. All writes require the Owner key.</p></div>
        <div className={styles.ownerKey}><KeyRound size={15}/><input type="password" value={ownerTokenDraft} onChange={(event) => setOwnerTokenDraft(event.target.value)} placeholder="Owner key"/><button type="button" onClick={saveOwnerToken}>Save</button></div>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => void bootstrap()} disabled={Boolean(busy)}><Database size={15}/>{busy === "bootstrap" ? "Configuring…" : "Bootstrap V2 campaigns"}</button>
        <button type="button" onClick={() => void syncSenders()} disabled={Boolean(busy) || !tCampaign || !eCampaign}><UsersRound size={15}/>{busy === "senders" ? "Syncing…" : "Sync sender pools"}</button>
        <button type="button" onClick={() => void analyzeNames()} disabled={Boolean(busy) || !data?.configuration.openRouterConfigured}><Sparkles size={15}/>{busy === "names" ? "Analyzing…" : "AI-analyze 150 names"}</button>
        <button type="button" onClick={() => void prepare()} disabled={Boolean(busy) || !safetyHealthy || !data?.capacity.liveNewLeadsPerDay}><Sparkles size={15}/>{busy === "prepare" ? "Preparing…" : "Prepare today"}</button>
        <button type="button" className={styles.primary} onClick={() => void launch()} disabled={Boolean(busy) || !data?.summary.prepared || !safetyHealthy}><Send size={15}/>{busy === "launch" ? "Safety checking…" : "Queue prepared batch"}</button>
        <button type="button" onClick={() => void changeStatus("all", "START")} disabled={Boolean(busy) || !tCampaign || !eCampaign}><Play size={15}/>Start both</button>
        <button type="button" onClick={() => void changeStatus("all", "PAUSED")} disabled={Boolean(busy) || (!tCampaign && !eCampaign)}><Pause size={15}/>Pause both</button>
      </div>
    </section>

    {!safetyHealthy && <section className={styles.warningPanel}><ShieldCheck size={18}/><div><strong>Sending is locked</strong><p>Sales activity safety must be healthy before Prepare or Queue.</p>{(data?.safety.warnings || []).map((warning) => <small key={warning}>{warning}</small>)}</div></section>}

    <section className={styles.healthGrid}>
      <article><strong>15-inbox capacity model</strong><span>{number(data?.capacity.liveCampaignEmailsPerDay)} live campaign emails/day</span><small>{number(data?.capacity.assignedInboxes)} assigned · {number(data?.capacity.eligibleInboxes)} eligible · max {number(data?.configuration.maxCampaignEmailsPerMailbox)}/mailbox · {number(data?.configuration.minTimeBetweenEmails)}m gap</small></article>
      <article><strong>Talentera route</strong><span>{number(data?.summary.talenteraReady)} ready · cap {number(data?.capacity.productLiveNewCaps.talentera)}/day</span><small>No verified ATS visible → sell Talentera ATS/recruitment workflow</small></article>
      <article><strong>Evalify route</strong><span>{number(data?.summary.evalifyReady)} ready · cap {number(data?.capacity.productLiveNewCaps.evalify)}/day</span><small>Existing/custom ATS detected → sell assessments/screening without replacing ATS</small></article>
      <article><strong>Deliverability</strong><span>Talentera {percent(data?.analytics.talentera.bounceRate)} · Evalify {percent(data?.analytics.evalify.bounceRate)} bounce</span><small>Plain text · open/click tracking off · stop on reply · global block/unsubscribe lists respected</small></article>
    </section>

    <section className={styles.sendersPanel}>
      <div className={styles.sectionHeader}><div><h2>Sender pools</h2><p>Automatic brand isolation. Evalify addresses never send Talentera copy and vice versa.</p></div></div>
      <div className={styles.senderGrid}>
        {(data?.senders || []).map((sender) => <div key={sender.id} className={styles.senderCard} data-selected={sender.assignedProducts.includes(sender.brand as OutreachProduct)}>
          <span>{sender.eligible ? "✓" : "!"}</span><div><strong>{sender.email}</strong><small>{sender.brand.toUpperCase()} · {sender.assignedProducts.length ? `assigned ${sender.assignedProducts.join(", ")}` : "not assigned"} · limit {sender.maxPerDay || "—"}/day · {warmupLabel(sender)}</small></div>
        </div>)}
      </div>
    </section>

    <section className={styles.previewPanel}>
      <div className={styles.sectionHeader}><div><h2>Sequence studio</h2><p>Fixed copy is the source of truth. OpenRouter only improves recipient language/greeting and one safe contextual opening line.</p></div></div>
      <div className={styles.previewGrid}>
        {(["talentera", "evalify"] as OutreachProduct[]).map((product) => {
          const seq = data?.sequenceCatalog[product].arSA;
          return <article key={product}><strong>{productLabel(product)} · Saudi Arabic · Day 0 → 3 → 7</strong><small>{product === "talentera" ? "No verified ATS" : "Existing ATS detected"}</small>
            <b>1. {seq?.subject1}</b><p>{seq?.touch1}</p><b>2. {seq?.subject2}</b><p>{seq?.touch2}</p><b>3. {seq?.subject3}</b><p>{seq?.touch3}</p>
          </article>;
        })}
      </div>
    </section>

    {Boolean(data?.preparedSamples.length) && <section className={styles.previewPanel}>
      <div className={styles.sectionHeader}><div><h2>Prepared copy preview</h2><p>Final rendered copy after OpenRouter recipient QA. Review this before Queue.</p></div></div>
      <div className={styles.previewGrid}>{data?.preparedSamples.map((lead) => <article key={lead.contactId}><strong>{lead.greetingName} · {lead.companyName} · {productLabel(lead.product)}</strong><small>{lead.locale} · confidence {percent(lead.languageConfidence)} · {lead.languageReason}</small><b>{lead.subject1}</b><p>{lead.touch1}</p></article>)}</div>
    </section>}

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Marita email queue</h2><p>One contact/company. Anyone who ever entered a managed sequence is blocked from re-entry.</p></div><span>{number(filtered.length)} shown</span></div>
      <div className={styles.filters}>
        <div>
          <button type="button" data-active={filter === "ready"} onClick={() => setFilter("ready")}>Ready</button>
          <button type="button" data-active={filter === "talentera"} onClick={() => setFilter("talentera")}>Talentera</button>
          <button type="button" data-active={filter === "evalify"} onClick={() => setFilter("evalify")}>Evalify</button>
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
          <td><strong>{productLabel(lead.product)}</strong><small>{lead.productReason}</small></td>
          <td><strong>{lead.detectedAts || "No Visible ATS"}</strong><small>{lead.atsStatus || "—"}</small></td>
          <td><small>{lead.blockReason || `${lead.priority} · score ${lead.priorityScore}`}</small></td>
        </tr>)}
      </tbody></table></div>
    </section>

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Execution ledger</h2><p>Smartlead status + persistent local ledger. Queued contacts remain excluded even after completion.</p></div><span>{number(data?.executions.length)} recent</span></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Contact</th><th>Product</th><th>Campaign</th><th>Status</th><th>Sequence step</th><th>Queued</th></tr></thead><tbody>
        {(data?.executions || []).slice(0, 250).map((row) => <tr key={`${row.email}:${row.campaignName}`}><td><strong>{row.email}</strong><small>{row.contactId || "—"}</small></td><td><strong>{productLabel(row.product)}</strong></td><td><small>{row.campaignName}</small></td><td><strong>{row.status}</strong></td><td>{row.sequenceStep || "—"}</td><td><small>{formatGeneratedAt(row.queuedAt)}</small></td></tr>)}
      </tbody></table></div>
    </section>
  </main>;
}
