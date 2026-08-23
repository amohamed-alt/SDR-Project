"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, CircleAlert, Clock3, Database,
  KeyRound, Mail, Pause, Play, RefreshCw, Search, Send, ShieldCheck, Sparkles, UsersRound,
} from "lucide-react";
import styles from "@/components/SmartleadCommandCenter.module.css";
import type { SmartleadCommandCenterPayload } from "@/lib/smartlead";

const OWNER_STORAGE_KEY = "sdr-acquisition-owner-token";

type QueueFilter = "ready" | "blocked" | "all";

function savedOwnerToken() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(OWNER_STORAGE_KEY) || "";
}

function number(value: number | undefined) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatGeneratedAt(value: string | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(value));
  } catch { return value; }
}

export function SmartleadCommandCenter({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<SmartleadCommandCenterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<QueueFilter>("ready");
  const [ownerToken, setOwnerToken] = useState(savedOwnerToken);
  const [ownerTokenDraft, setOwnerTokenDraft] = useState(savedOwnerToken);
  const [selectedSenders, setSelectedSenders] = useState<Set<number>>(new Set());

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/smartlead${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const payload = await response.json() as SmartleadCommandCenterPayload & { error?: string; details?: string };
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load Smartlead.");
      setData(payload);
      setSelectedSenders(new Set(payload.senders.filter((sender) => sender.assigned).map((sender) => sender.id)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Smartlead.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function saveOwnerToken() {
    const value = ownerTokenDraft.trim();
    setOwnerToken(value);
    if (value) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
    setNotice(value ? "Owner key saved for this browser session." : "Owner key cleared.");
  }

  async function action(body: Record<string, unknown>, busyKey: string) {
    if (!ownerToken) {
      setError("Enter the Owner key first. The Smartlead API key never goes in the browser.");
      return null;
    }
    setBusy(busyKey);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/smartlead", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerToken },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as Record<string, unknown> & { error?: string; details?: string };
      if (!response.ok) throw new Error(payload.details || payload.error || "Smartlead action failed.");
      await load(true);
      return payload;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Smartlead action failed.");
      return null;
    } finally { setBusy(""); }
  }

  async function bootstrap() {
    if (!window.confirm("Create or refresh the Talentera Marita Smartlead campaign as a safe 3-touch campaign? This does not start sending.")) return;
    const result = await action({ action: "bootstrap" }, "bootstrap");
    if (result) setNotice("Campaign structure refreshed: plain text, tracking off, stop on reply, 3 touches, Riyadh schedule. It remains under your start/pause control.");
  }

  async function prepare() {
    const result = await action({ action: "prepare", limit: data?.summary.dailyNewCap || 75 }, "prepare");
    if (result) setNotice(`Prepared ${String(result.prepared || 0)} Marita lead(s) across ${String(result.segments || 0)} localized segment(s). No email was sent.`);
  }

  async function attachSenders() {
    if (!selectedSenders.size) {
      setError("Select at least one Smartlead sender.");
      return;
    }
    const result = await action({ action: "attach_senders", senderIds: [...selectedSenders] }, "senders");
    if (result) setNotice(`Attached ${String(result.attached || 0)} sender account(s) to the Talentera campaign.`);
  }

  async function launch() {
    const prepared = data?.summary.prepared || 0;
    if (!prepared) {
      setError("Prepare today's batch first.");
      return;
    }
    if (!window.confirm(`Queue ${prepared} prepared Marita lead(s) into Smartlead? The server will re-check Sales activity, deals and email safety immediately before the upload.`)) return;
    const result = await action({ action: "launch", confirm: "QUEUE_MARITA_BATCH" }, "launch");
    if (result) {
      setNotice(`Smartlead accepted ${String(result.queued || 0)} lead(s). ${String(result.skippedByFreshSafetyCheck || 0)} were removed by the fresh safety check. Campaign status: ${String(result.campaignStatus || "unknown")}.`);
    }
  }

  async function changeStatus(status: "START" | "PAUSED") {
    const actionName = status === "START" ? "start/resume" : "pause";
    if (!window.confirm(`${actionName} the Talentera Smartlead campaign?`)) return;
    const result = await action({ action: "status", status, confirm: "CHANGE_CAMPAIGN_STATUS" }, `status:${status}`);
    if (result) setNotice(status === "START" ? "Campaign is active. Smartlead will execute according to its schedule and sender limits." : "Campaign paused.");
  }

  function toggleSender(id: number) {
    setSelectedSenders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.queue || []).filter((lead) => {
      if (filter === "ready" && !lead.eligible) return false;
      if (filter === "blocked" && lead.eligible) return false;
      if (!query) return true;
      return [lead.fullName, lead.email, lead.companyName, lead.country, lead.industry, lead.persona, lead.detectedAts, lead.blockReason]
        .join(" ").toLowerCase().includes(query);
    });
  }, [data, filter, search]);

  const assignedSenders = data?.senders.filter((sender) => sender.assigned).length || 0;
  const campaignStatus = data?.campaign?.status || "NOT CREATED";
  const safetyHealthy = Boolean(data?.safety.healthy);

  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/> SDR Dashboard</button>
      <div className={styles.title}>
        <span><Mail size={15}/>SMARTLEAD OUTREACH</span>
        <h1>Marita email execution</h1>
        <p>Marita-only routing · Sales conflict protection · localized Talentera copy · live Smartlead execution.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}>
        <RefreshCw size={15} className={loading ? styles.spin : ""}/>{loading ? "Refreshing" : "Refresh"}
      </button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={16}/>{error}</div>}
    {notice && <div className={styles.success}><CheckCircle2 size={16}/>{notice}</div>}

    <section className={styles.statusRow}>
      <span data-ok={data?.configuration.apiConfigured}><Database size={14}/> Smartlead API {data?.configuration.apiConfigured ? "connected" : "missing"}</span>
      <span data-ok={data?.configuration.openRouterConfigured}><Sparkles size={14}/> OpenRouter {data?.configuration.openRouterConfigured ? "ready" : "missing"}</span>
      <span data-ok={safetyHealthy}><ShieldCheck size={14}/> Sales safety {safetyHealthy ? "healthy" : "blocked"}</span>
      <span data-ok={Boolean(data?.campaign)}><Mail size={14}/> Campaign {campaignStatus}</span>
      <small>Updated {formatGeneratedAt(data?.generatedAt)} Riyadh</small>
    </section>

    <section className={styles.metrics}>
      <article><BadgeCheck size={18}/><span>Ready</span><strong>{number(data?.summary.ready)}</strong><small>safe Marita contacts</small></article>
      <article><Send size={18}/><span>Today</span><strong>{number(data?.summary.today)}</strong><small>new leads planned</small></article>
      <article><CalendarClock size={18}/><span>Tomorrow</span><strong>{number(data?.summary.tomorrow)}</strong><small>new leads planned</small></article>
      <article><Clock3 size={18}/><span>Next 48h</span><strong>{number(data?.summary.next48Hours)}</strong><small>new-lead coverage</small></article>
      <article><Database size={18}/><span>Coverage</span><strong>{data?.summary.coverageDays ?? 0}d</strong><small>at {number(data?.summary.dailyNewCap)}/day</small></article>
      <article><UsersRound size={18}/><span>Prepared</span><strong>{number(data?.summary.prepared)}</strong><small>waiting for queue</small></article>
    </section>

    <section className={styles.executionPanel}>
      <div className={styles.executionIntro}>
        <div><strong>Execution controls</strong><p>Every write requires the Owner key. The Smartlead API secret stays server-side.</p></div>
        <div className={styles.ownerKey}>
          <KeyRound size={15}/>
          <input type="password" value={ownerTokenDraft} onChange={(event) => setOwnerTokenDraft(event.target.value)} placeholder="Owner key"/>
          <button type="button" onClick={saveOwnerToken}>Save</button>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => void bootstrap()} disabled={Boolean(busy)}><Database size={15}/>{busy === "bootstrap" ? "Configuring…" : data?.campaign ? "Refresh campaign" : "Create campaign"}</button>
        <button type="button" onClick={() => void prepare()} disabled={Boolean(busy) || !safetyHealthy || !data?.configuration.openRouterConfigured}><Sparkles size={15}/>{busy === "prepare" ? "Generating…" : "Prepare today"}</button>
        <button type="button" className={styles.primary} onClick={() => void launch()} disabled={Boolean(busy) || !data?.summary.prepared || !assignedSenders || !safetyHealthy}><Send size={15}/>{busy === "launch" ? "Safety checking…" : "Queue prepared batch"}</button>
        <button type="button" onClick={() => void changeStatus("START")} disabled={Boolean(busy) || !data?.campaign || !assignedSenders}><Play size={15}/>Start / resume</button>
        <button type="button" onClick={() => void changeStatus("PAUSED")} disabled={Boolean(busy) || !data?.campaign}><Pause size={15}/>Pause</button>
      </div>
    </section>

    {!safetyHealthy && <section className={styles.warningPanel}>
      <ShieldCheck size={18}/><div><strong>Sending is locked</strong><p>The Sales activity scan must be fully healthy before Prepare or Queue is allowed.</p>
      {(data?.safety.warnings || []).map((warning) => <small key={warning}>{warning}</small>)}</div>
    </section>}

    <section className={styles.healthGrid}>
      <article><strong>Campaign</strong><span>{data?.campaign?.name || data?.configuration.campaignName || "Not created"}</span><small>Status {campaignStatus} · {number(data?.campaign?.maxLeadsPerDay)} max new leads/day</small></article>
      <article><strong>Sales protection</strong><span>{number(data?.summary.blockedBySales)} queue contacts blocked</span><small>{number(data?.safety.recentSalesActivities)} recent Sales activities · {number(data?.safety.blockedCompanies)} companies protected</small></article>
      <article><strong>Smartlead results</strong><span>{number(data?.analytics.sent)} sent · {number(data?.analytics.replies)} replies</span><small>{number(data?.analytics.bounces)} bounced · {number(data?.analytics.unsubscribed)} unsubscribed</small></article>
    </section>

    <section className={styles.sendersPanel}>
      <div className={styles.sectionHeader}><div><h2>Sender accounts</h2><p>Select the warmed inboxes that belong to this Talentera campaign.</p></div><button type="button" onClick={() => void attachSenders()} disabled={Boolean(busy) || !selectedSenders.size}>{busy === "senders" ? "Attaching…" : "Attach selected"}</button></div>
      <div className={styles.senderGrid}>
        {(data?.senders || []).map((sender) => <button key={sender.id} type="button" className={styles.senderCard} data-selected={selectedSenders.has(sender.id)} onClick={() => toggleSender(sender.id)}>
          <span>{selectedSenders.has(sender.id) ? "✓" : ""}</span><div><strong>{sender.email || `Sender ${sender.id}`}</strong><small>{sender.assigned ? "Assigned" : "Available"} · limit {sender.maxPerDay || "—"}/day · warmup {sender.warmupEnabled ? "on" : "status unavailable"}</small></div>
        </button>)}
        {!data?.senders.length && <p className={styles.empty}>No Smartlead sender accounts returned yet.</p>}
      </div>
    </section>

    {Boolean(data?.preparedSamples.length) && <section className={styles.previewPanel}>
      <div className={styles.sectionHeader}><div><h2>Prepared copy preview</h2><p>Sample only. The batch is regenerated by country, industry, persona and ATS context.</p></div></div>
      <div className={styles.previewGrid}>{data?.preparedSamples.map((lead) => <article key={lead.contactId}>
        <strong>{lead.fullName} · {lead.companyName}</strong><small>{lead.locale} · {lead.industryBucket} · {lead.persona}</small>
        <b>{lead.subject1}</b><p>{lead.touch1}</p>
      </article>)}</div>
    </section>}

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Marita email queue</h2><p>One best email contact per eligible company. Sales activity protects the entire company.</p></div><span>{number(filtered.length)} shown</span></div>
      <div className={styles.filters}>
        <div><button type="button" data-active={filter === "ready"} onClick={() => setFilter("ready")}>Ready</button><button type="button" data-active={filter === "blocked"} onClick={() => setFilter("blocked")}>Blocked</button><button type="button" data-active={filter === "all"} onClick={() => setFilter("all")}>All</button></div>
        <label><Search size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, person, country, ATS…"/></label>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Status</th><th>Contact</th><th>Company</th><th>Routing</th><th>ATS</th><th>Reason</th></tr></thead><tbody>
        {filtered.slice(0, 250).map((lead) => <tr key={`${lead.companyId}:${lead.contactId}`}>
          <td><span className={lead.eligible ? styles.ready : styles.blocked}>{lead.eligible ? "READY" : "BLOCKED"}</span></td>
          <td><strong>{lead.fullName}</strong><small>{lead.title}</small><small>{lead.email}</small></td>
          <td><strong>{lead.companyName}</strong><small>{lead.country}</small></td>
          <td><strong>{lead.locale}</strong><small>{lead.industryBucket} · {lead.persona}</small></td>
          <td><strong>{lead.detectedAts || "No ATS detected"}</strong><small>{lead.atsAngle}</small></td>
          <td><small>{lead.blockReason || `P${lead.priority.replace("P", "")} · score ${lead.priorityScore}`}</small></td>
        </tr>)}
      </tbody></table></div>
      {!filtered.length && <div className={styles.empty}>No contacts match this view.</div>}
    </section>
  </main>;
}
