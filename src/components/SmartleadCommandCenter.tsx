"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, CircleAlert, Clock3, Database,
  KeyRound, Mail, Pause, Play, RefreshCw, Search, Send, ShieldCheck, Sparkles, UsersRound,
} from "lucide-react";
import styles from "@/components/SmartleadCommandCenter.module.css";
import type { SmartleadCommandCenterPayload, SmartleadSender } from "@/lib/smartlead";

const OWNER_STORAGE_KEY = "sdr-acquisition-owner-token";

type QueueFilter = "ready" | "blocked" | "all";

function savedOwnerToken() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(OWNER_STORAGE_KEY) || "";
}

function number(value: number | undefined) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function percent(value: number | undefined) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function formatGeneratedAt(value: string | undefined) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(value));
  } catch { return value; }
}

function warmupLabel(sender: SmartleadSender) {
  if (!sender.warmupKnown) return "warmup status unavailable";
  return sender.warmupEnabled ? "warmup on" : "warmup off";
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
      setSelectedSenders(new Set(payload.senders
        .filter((sender) => sender.assigned && sender.eligibleForCampaign)
        .map((sender) => sender.id)));
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
    if (result) setNotice("Campaign refreshed: fixed 3-touch copy by default, plain text, tracking off, stop on reply, and conservative Riyadh sending schedule. It remains under your Start/Pause control.");
  }

  async function prepare() {
    const result = await action({ action: "prepare", limit: Math.max(1, data?.summary.dailyNewCap || 1) }, "prepare");
    if (result) setNotice(`Prepared ${String(result.prepared || 0)} Marita lead(s) across ${String(result.segments || 0)} routed segment(s). Safe new-lead cap: ${String(result.safeNewLeadCap || 0)}. No email was sent.`);
  }

  async function attachSenders() {
    if (!selectedSenders.size) {
      setError("Select at least one eligible Talentera sender.");
      return;
    }
    const result = await action({ action: "attach_senders", senderIds: [...selectedSenders] }, "senders");
    if (result) setNotice(`Synced ${String(result.attached || 0)} Talentera sender(s). Removed ${String(result.removed || 0)} mismatched/unselected sender(s). Safe new-lead cap: ${String(result.safeNewLeadCap || 0)}/day.`);
  }

  async function launch() {
    const prepared = data?.summary.prepared || 0;
    if (!prepared) {
      setError("Prepare today's batch first.");
      return;
    }
    if (!window.confirm(`Queue ${prepared} prepared Marita lead(s) into Smartlead? The server will re-check Sales activity, language/greeting routing, sender brand, bounce safety and email status immediately before upload.`)) return;
    const result = await action({ action: "launch", confirm: "QUEUE_MARITA_BATCH" }, "launch");
    if (result) {
      setNotice(`Smartlead accepted ${String(result.queued || 0)} lead(s). ${String(result.skippedByFreshSafetyCheck || 0)} were removed by the fresh safety check. Campaign status: ${String(result.campaignStatus || "unknown")}.`);
    }
  }

  async function changeStatus(status: "START" | "PAUSED") {
    const actionName = status === "START" ? "start/resume" : "pause";
    if (!window.confirm(`${actionName} the Talentera Smartlead campaign?`)) return;
    const result = await action({ action: "status", status, confirm: "CHANGE_CAMPAIGN_STATUS" }, `status:${status}`);
    if (result) setNotice(status === "START" ? "Campaign is active under the current reputation guard, schedule and sender capacity." : "Campaign paused.");
  }

  function toggleSender(sender: SmartleadSender) {
    if (!sender.eligibleForCampaign) {
      setError(sender.brand === "evalify"
        ? "Evalify inboxes are isolated from Talentera campaigns."
        : "This sender is blocked because its brand or warmup state is not safe for the Talentera campaign.");
      return;
    }
    setSelectedSenders((current) => {
      const next = new Set(current);
      if (next.has(sender.id)) next.delete(sender.id); else next.add(sender.id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.queue || []).filter((lead) => {
      if (filter === "ready" && !lead.eligible) return false;
      if (filter === "blocked" && lead.eligible) return false;
      if (!query) return true;
      return [lead.fullName, lead.greetingName, lead.email, lead.companyName, lead.country, lead.industry, lead.persona, lead.locale, lead.languageReason, lead.detectedAts, lead.blockReason]
        .join(" ").toLowerCase().includes(query);
    });
  }, [data, filter, search]);

  const assignedSenders = data?.senders.filter((sender) => sender.assigned && sender.eligibleForCampaign).length || 0;
  const campaignStatus = data?.campaign?.status || "NOT CREATED";
  const safetyHealthy = Boolean(data?.safety.healthy);
  const fixedSequence = data?.configuration.sequenceMode !== "ai-segment";
  const canPrepare = safetyHealthy && assignedSenders > 0 && (fixedSequence || Boolean(data?.configuration.openRouterConfigured));

  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/> SDR Dashboard</button>
      <div className={styles.title}>
        <span><Mail size={15}/>SMARTLEAD OUTREACH</span>
        <h1>Marita email execution</h1>
        <p>Marita-only routing · language confidence · Talentera/Evalify sender isolation · reputation-protected Smartlead execution.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}>
        <RefreshCw size={15} className={loading ? styles.spin : ""}/>{loading ? "Refreshing" : "Refresh"}
      </button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={16}/>{error}</div>}
    {notice && <div className={styles.success}><CheckCircle2 size={16}/>{notice}</div>}

    <section className={styles.statusRow}>
      <span data-ok={data?.configuration.apiConfigured}><Database size={14}/> Smartlead API {data?.configuration.apiConfigured ? "connected" : "missing"}</span>
      <span data-ok={fixedSequence || data?.configuration.openRouterConfigured}><Sparkles size={14}/> Sequence {fixedSequence ? "fixed" : data?.configuration.openRouterConfigured ? "AI-ready" : "AI missing"}</span>
      <span data-ok={safetyHealthy}><ShieldCheck size={14}/> Outreach safety {safetyHealthy ? "healthy" : "blocked"}</span>
      <span data-ok={data?.reputation.healthy}><Mail size={14}/> Reputation {data?.reputation.healthy ? "healthy" : "locked"}</span>
      <small>Updated {formatGeneratedAt(data?.generatedAt)} Riyadh</small>
    </section>

    <section className={styles.metrics}>
      <article><BadgeCheck size={18}/><span>Ready</span><strong>{number(data?.summary.ready)}</strong><small>safe Marita contacts</small></article>
      <article><Send size={18}/><span>Today</span><strong>{number(data?.summary.today)}</strong><small>reputation-safe new leads</small></article>
      <article><CalendarClock size={18}/><span>Tomorrow</span><strong>{number(data?.summary.tomorrow)}</strong><small>new leads planned</small></article>
      <article><Clock3 size={18}/><span>Next 48h</span><strong>{number(data?.summary.next48Hours)}</strong><small>safe new-lead coverage</small></article>
      <article><Database size={18}/><span>Coverage</span><strong>{data?.summary.coverageDays ?? 0}d</strong><small>at {number(data?.summary.dailyNewCap)}/day</small></article>
      <article><UsersRound size={18}/><span>Prepared</span><strong>{number(data?.summary.prepared)}</strong><small>waiting for queue</small></article>
    </section>

    <section className={styles.executionPanel}>
      <div className={styles.executionIntro}>
        <div><strong>Execution controls</strong><p>Every write requires the Owner key. The Smartlead API secret stays server-side. Prepare is capped by assigned Talentera sender capacity.</p></div>
        <div className={styles.ownerKey}>
          <KeyRound size={15}/>
          <input type="password" value={ownerTokenDraft} onChange={(event) => setOwnerTokenDraft(event.target.value)} placeholder="Owner key"/>
          <button type="button" onClick={saveOwnerToken}>Save</button>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => void bootstrap()} disabled={Boolean(busy)}><Database size={15}/>{busy === "bootstrap" ? "Configuring…" : data?.campaign ? "Refresh campaign" : "Create campaign"}</button>
        <button type="button" onClick={() => void prepare()} disabled={Boolean(busy) || !canPrepare}><Sparkles size={15}/>{busy === "prepare" ? "Preparing…" : "Prepare today"}</button>
        <button type="button" className={styles.primary} onClick={() => void launch()} disabled={Boolean(busy) || !data?.summary.prepared || !assignedSenders || !safetyHealthy}><Send size={15}/>{busy === "launch" ? "Safety checking…" : "Queue prepared batch"}</button>
        <button type="button" onClick={() => void changeStatus("START")} disabled={Boolean(busy) || !data?.campaign || !assignedSenders || !safetyHealthy}><Play size={15}/>Start / resume</button>
        <button type="button" onClick={() => void changeStatus("PAUSED")} disabled={Boolean(busy) || !data?.campaign}><Pause size={15}/>Pause</button>
      </div>
    </section>

    {!safetyHealthy && <section className={styles.warningPanel}>
      <ShieldCheck size={18}/><div><strong>Sending is locked</strong><p>Sales protection and deliverability checks must be healthy before Prepare, Queue or Start.</p>
      {(data?.safety.warnings || []).map((warning) => <small key={warning}>{warning}</small>)}</div>
    </section>}

    <section className={styles.healthGrid}>
      <article><strong>Campaign</strong><span>{data?.campaign?.name || data?.configuration.campaignName || "Not created"}</span><small>Status {campaignStatus} · {data?.configuration.sequenceMode || "fixed"} sequence · {number(data?.configuration.minTimeBetweenEmails)} min gap</small></article>
      <article><strong>Sender reputation</strong><span>{number(data?.reputation.assignedTalenteraSenders)} Talentera inboxes · safe cap {number(data?.reputation.safeNewLeadCap)}/day</span><small>{number(data?.reputation.senderDailyCapacity)} campaign emails/day reserved · bounce {percent(data?.reputation.bounceRate)}</small></article>
      <article><strong>Sales protection</strong><span>{number(data?.summary.blockedBySales)} queue contacts blocked</span><small>{number(data?.safety.recentSalesActivities)} recent Sales activities · {number(data?.safety.blockedCompanies)} companies protected</small></article>
      <article><strong>Smartlead results</strong><span>{number(data?.analytics.sent)} sent · {number(data?.analytics.replies)} replies</span><small>{number(data?.analytics.bounces)} bounced · {number(data?.analytics.unsubscribed)} unsubscribed</small></article>
    </section>

    <section className={styles.sendersPanel}>
      <div className={styles.sectionHeader}><div><h2>Sender accounts</h2><p>Only warmed Talentera inboxes can be attached here. Evalify stays isolated for its own campaigns.</p></div><button type="button" onClick={() => void attachSenders()} disabled={Boolean(busy) || !selectedSenders.size}>{busy === "senders" ? "Syncing…" : "Sync selected"}</button></div>
      <div className={styles.senderGrid}>
        {(data?.senders || []).map((sender) => <button
          key={sender.id}
          type="button"
          className={styles.senderCard}
          data-selected={sender.eligibleForCampaign && selectedSenders.has(sender.id)}
          disabled={!sender.eligibleForCampaign}
          onClick={() => toggleSender(sender)}
          title={sender.eligibleForCampaign ? "Eligible for Talentera" : `${sender.brand} sender — blocked from this campaign`}
        >
          <span>{sender.eligibleForCampaign && selectedSenders.has(sender.id) ? "✓" : ""}</span><div><strong>{sender.email || `Sender ${sender.id}`}</strong><small>{sender.brand.toUpperCase()} · {sender.assigned ? "Assigned" : "Available"} · limit {sender.maxPerDay || "—"}/day · {warmupLabel(sender)}</small></div>
        </button>)}
        {!data?.senders.length && <p className={styles.empty}>No Smartlead sender accounts returned yet.</p>}
      </div>
    </section>

    {Boolean(data?.preparedSamples.length) && <section className={styles.previewPanel}>
      <div className={styles.sectionHeader}><div><h2>Prepared copy preview</h2><p>Fixed 3-touch sequence by default. Greeting and language are resolved conservatively before the batch can be queued.</p></div></div>
      <div className={styles.previewGrid}>{data?.preparedSamples.map((lead) => <article key={lead.contactId}>
        <strong>{lead.fullName} · {lead.companyName}</strong><small>Greeting: {lead.greetingName || "no name"} · {lead.locale} · confidence {Math.round(lead.languageConfidence * 100)}%{lead.nameTranslated ? " · translated" : ""}</small>
        <b>{lead.subject1}</b><p>{lead.touch1}</p>
      </article>)}</div>
    </section>}

    <section className={styles.queuePanel}>
      <div className={styles.sectionHeader}><div><h2>Marita email queue</h2><p>One best email contact per eligible company. Sales activity protects the entire company; ambiguous names safely fall back to English.</p></div><span>{number(filtered.length)} shown</span></div>
      <div className={styles.filters}>
        <div><button type="button" data-active={filter === "ready"} onClick={() => setFilter("ready")}>Ready</button><button type="button" data-active={filter === "blocked"} onClick={() => setFilter("blocked")}>Blocked</button><button type="button" data-active={filter === "all"} onClick={() => setFilter("all")}>All</button></div>
        <label><Search size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, person, language, country, ATS…"/></label>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Status</th><th>Contact</th><th>Company</th><th>Language routing</th><th>ATS</th><th>Reason</th></tr></thead><tbody>
        {filtered.slice(0, 250).map((lead) => <tr key={`${lead.companyId}:${lead.contactId}`}>
          <td><span className={lead.eligible ? styles.ready : styles.blocked}>{lead.eligible ? "READY" : "BLOCKED"}</span></td>
          <td><strong>{lead.fullName}</strong><small>{lead.title}</small><small>{lead.email}</small></td>
          <td><strong>{lead.companyName}</strong><small>{lead.country}</small></td>
          <td><strong>{lead.locale} · {lead.greetingName || "no greeting name"}</strong><small>{Math.round(lead.languageConfidence * 100)}% · {lead.nameTranslated ? "Arabic name mapped" : "original name"}</small><small>{lead.languageReason}</small></td>
          <td><strong>{lead.detectedAts || "No ATS detected"}</strong><small>{lead.atsAngle}</small></td>
          <td><small>{lead.blockReason || `P${lead.priority.replace("P", "")} · score ${lead.priorityScore}`}</small></td>
        </tr>)}
      </tbody></table></div>
      {!filtered.length && <div className={styles.empty}>No contacts match this view.</div>}
    </section>
  </main>;
}
