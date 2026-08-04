"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  FileText,
  Link2,
  PhoneCall,
  RefreshCw,
  Search,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "@/components/MaqsamCallsDashboard.module.css";
import type { MaqsamCallRecord, MaqsamCallsResponse, MaqsamMatchStatus } from "@/lib/maqsam-types";

const defaultFrom = process.env.NEXT_PUBLIC_DEFAULT_START_DATE ?? new Date().toISOString().slice(0, 7) + "-01";
const today = new Date().toISOString().slice(0, 10);

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatDate(value?: string, timestamp?: number | null) {
  const source = value || (timestamp ? new Date(timestamp * 1000).toISOString() : "");
  if (!source) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(source));
}

function dayKey(record: MaqsamCallRecord) {
  if (record.noteTimestamp) return record.noteTimestamp.slice(0, 10);
  if (record.timestamp) return new Date(record.timestamp * 1000).toISOString().slice(0, 10);
  return "Unknown";
}

function normalizeSentiment(value?: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("positive")) return "Positive";
  if (normalized.includes("negative")) return "Negative";
  if (normalized.includes("neutral")) return "Neutral";
  return "Unknown";
}

function statusLabel(status?: MaqsamMatchStatus) {
  if (status === "matched") return "Matched";
  if (status === "ambiguous") return "Ambiguous";
  return "Unmatched";
}

function noteLabel(status?: MaqsamCallRecord["hubspotNoteStatus"]) {
  if (status === "synced") return "Note synced";
  if (status === "already_synced") return "Already synced";
  if (status === "pending") return "Note pending";
  if (status === "failed") return "Note failed";
  return "No HubSpot note";
}

function MetricCard({ label, value, helper, icon: Icon }: {
  label: string;
  value: string | number;
  helper: string;
  icon: LucideIcon;
}) {
  return <article className={styles.metricCard}>
    <span className={styles.metricIcon}><Icon size={18}/></span>
    <div>
      <small>{label}</small>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
      <p>{helper}</p>
    </div>
  </article>;
}

export function MaqsamCallsDashboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<MaqsamCallsResponse | null>(null);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [appliedRange, setAppliedRange] = useState({ from: defaultFrom, to: today });
  const [search, setSearch] = useState("");
  const [matchStatus, setMatchStatus] = useState<"all" | MaqsamMatchStatus>("all");
  const [expandedCallKey, setExpandedCallKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        from: appliedRange.from,
        to: appliedRange.to,
        limit: "5000",
      });
      if (refreshKey) query.set("refresh", String(refreshKey));
      const response = await fetch(`/api/maqsam/calls?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load Maqsam calls");
      setData(payload as MaqsamCallsResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load Maqsam calls");
    } finally {
      setLoading(false);
    }
  }, [appliedRange, refreshKey]);

  useEffect(() => { void loadData(); }, [loadData]);

  const model = useMemo(() => {
    const calls = data?.calls ?? [];
    const filtered = calls.filter((record) => {
      if (matchStatus !== "all" && record.matchStatus !== matchStatus) return false;
      if (!search.trim()) return true;
      const term = search.trim().toLowerCase();
      return [
        record.callId,
        record.referenceId,
        record.phone,
        record.agentName,
        record.agentEmail,
        record.contactName,
        record.contactEmail,
        record.summary,
        record.transcription,
      ].some((value) => String(value ?? "").toLowerCase().includes(term));
    });

    const matched = calls.filter((record) => record.matchStatus === "matched").length;
    const unmatched = calls.filter((record) => record.matchStatus === "unmatched").length;
    const ambiguous = calls.filter((record) => record.matchStatus === "ambiguous").length;
    const noteSynced = calls.filter((record) => ["synced", "already_synced"].includes(record.hubspotNoteStatus ?? "")).length;
    const withTranscript = calls.filter((record) => Boolean(record.transcription?.trim())).length;
    const averageDuration = calls.length
      ? calls.reduce((total, record) => total + Number(record.durationSeconds ?? 0), 0) / calls.length
      : 0;

    const dailyMap = new Map<string, { date: string; calls: number; matched: number; unmatched: number }>();
    for (const record of calls) {
      const date = dayKey(record);
      const row = dailyMap.get(date) ?? { date, calls: 0, matched: 0, unmatched: 0 };
      row.calls += 1;
      if (record.matchStatus === "matched") row.matched += 1;
      else row.unmatched += 1;
      dailyMap.set(date, row);
    }

    const sentimentMap = new Map<string, number>();
    for (const record of calls) {
      const sentiment = normalizeSentiment(record.sentiment);
      sentimentMap.set(sentiment, (sentimentMap.get(sentiment) ?? 0) + 1);
    }

    return {
      calls,
      filtered,
      matched,
      unmatched,
      ambiguous,
      noteSynced,
      withTranscript,
      averageDuration,
      daily: [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
      sentiments: [...sentimentMap.entries()].map(([name, value]) => ({ name, value })),
    };
  }, [data, matchStatus, search]);

  const portalId = data?.meta.portalId ?? "145742477";

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.titleGroup}>
        <button type="button" className={styles.secondaryButton} onClick={onBack}><ArrowLeft size={15}/>Analytics Dashboard</button>
        <div>
          <strong>Maqsam Call Intelligence</strong>
          <span>Marita call summaries, transcripts, HubSpot matches, and sync status</span>
        </div>
      </div>
      <div className={styles.actions}>
        <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
        <label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
        <button type="button" className={styles.secondaryButton} onClick={() => setAppliedRange({ from, to })}>Apply range</button>
        <button type="button" className={styles.primaryButton} disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>
          <RefreshCw size={14} className={loading ? styles.spin : ""}/>Refresh
        </button>
      </div>
    </header>

    <div className={styles.content}>
      <section className={styles.hero}>
        <div>
          <span><PhoneCall size={15}/>CALL OPERATIONS</span>
          <h1>Every completed Maqsam call stays visible, even when HubSpot has no matching contact.</h1>
          <p>Matched calls receive HubSpot notes. Unmatched and ambiguous calls remain searchable in this dashboard with the full AI summary and transcript.</p>
        </div>
        <aside>
          <strong>{data?.meta.totalStored ?? 0}</strong>
          <span>calls retained in durable dashboard storage</span>
          <small>Unique key: Maqsam Call ID / Reference ID</small>
        </aside>
      </section>

      {error && <div className={styles.errorBanner}><AlertTriangle size={16}/>{error}</div>}
      {loading && !data && <div className={styles.loading}><div className={styles.loader}/><strong>Loading Maqsam calls…</strong></div>}

      {data && <>
        <section className={styles.metrics}>
          <MetricCard label="Calls" value={model.calls.length} helper="Completed calls in range" icon={PhoneCall}/>
          <MetricCard label="Matched" value={model.matched} helper="Unique HubSpot contact found" icon={UserRoundCheck}/>
          <MetricCard label="Unmatched" value={model.unmatched} helper="Kept in dashboard only" icon={UserRoundX}/>
          <MetricCard label="Ambiguous" value={model.ambiguous} helper="Multiple equally safe matches" icon={UsersRound}/>
          <MetricCard label="Notes synced" value={model.noteSynced} helper="Created or already present" icon={CheckCircle2}/>
          <MetricCard label="With transcript" value={model.withTranscript} helper="Full transcript available" icon={FileText}/>
          <MetricCard label="Average duration" value={formatDuration(model.averageDuration)} helper="Across visible calls" icon={Clock3}/>
        </section>

        <section className={styles.chartGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Daily Maqsam calls</h2><p>Total calls split by HubSpot match result.</p></div><BarChart3 size={18}/></div>
            {model.daily.length ? <ResponsiveContainer width="100%" height={300}>
              <BarChart data={model.daily} margin={{ left: -16, right: 10, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe8e3"/>
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 10 }}/>
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }}/>
                <Tooltip/>
                <Legend/>
                <Bar dataKey="matched" stackId="calls" fill="#087a50" name="Matched"/>
                <Bar dataKey="unmatched" stackId="calls" fill="#d98d25" name="Unmatched / ambiguous"/>
              </BarChart>
            </ResponsiveContainer> : <div className={styles.empty}>No calls in this date range.</div>}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Sentiment</h2><p>Maqsam sentiment classification for completed calls.</p></div><BarChart3 size={18}/></div>
            {model.sentiments.length ? <ResponsiveContainer width="100%" height={300}>
              <BarChart data={model.sentiments} layout="vertical" margin={{ left: 12, right: 18, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe8e3"/>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }}/>
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 10 }}/>
                <Tooltip/>
                <Bar dataKey="value" fill="#744bc4" name="Calls"/>
              </BarChart>
            </ResponsiveContainer> : <div className={styles.empty}>No sentiment data available.</div>}
          </article>
        </section>

        <section className={styles.tablePanel}>
          <div className={styles.tableHeader}>
            <div><h2>Call records</h2><p>Click a row to open the AI summary and complete transcript.</p></div>
            <div className={styles.filters}>
              <label className={styles.searchBox}><Search size={14}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search phone, contact, agent, summary…"/></label>
              <select value={matchStatus} onChange={(event) => setMatchStatus(event.target.value as "all" | MaqsamMatchStatus)}>
                <option value="all">All match statuses</option>
                <option value="matched">Matched</option>
                <option value="unmatched">Unmatched</option>
                <option value="ambiguous">Ambiguous</option>
              </select>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Call</th><th>Contact</th><th>Direction</th><th>Duration</th><th>Sentiment</th><th>HubSpot match</th><th>Note</th><th/></tr></thead>
              <tbody>
                {model.filtered.map((record) => {
                  const expanded = expandedCallKey === record.callKey;
                  const contactUrl = record.hubspotContactId
                    ? `https://app-eu1.hubspot.com/contacts/${portalId}/record/0-1/${record.hubspotContactId}`
                    : "";
                  return <Fragment key={record.callKey}>
                    <tr className={styles.recordRow} onClick={() => setExpandedCallKey(expanded ? "" : record.callKey)}>
                      <td><strong>#{record.callId ?? record.referenceId ?? record.callKey}</strong><span>{formatDate(record.noteTimestamp, record.timestamp)}</span><small>{record.agentName || record.agentEmail || "Marita"}</small></td>
                      <td><strong>{record.contactName || "No matched contact"}</strong><span>{record.phone || "—"}</span><small>{record.contactEmail || ""}</small></td>
                      <td><span className={styles.direction}>{record.direction || "Unknown"}</span></td>
                      <td>{formatDuration(record.durationSeconds)}</td>
                      <td><span className={styles.sentiment} data-sentiment={normalizeSentiment(record.sentiment).toLowerCase()}>{normalizeSentiment(record.sentiment)}</span></td>
                      <td><span className={styles.matchBadge} data-status={record.matchStatus ?? "unmatched"}>{statusLabel(record.matchStatus)}</span></td>
                      <td><span className={styles.noteBadge} data-status={record.hubspotNoteStatus ?? "not_applicable"}>{noteLabel(record.hubspotNoteStatus)}</span></td>
                      <td><button type="button" className={styles.expandButton} aria-label={expanded ? "Collapse call" : "Expand call"}>{expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button></td>
                    </tr>
                    {expanded && <tr className={styles.detailRow}><td colSpan={8}>
                      <div className={styles.detailGrid}>
                        <article>
                          <div className={styles.detailHeading}><h3>AI Summary</h3><span>{record.summaryLanguage?.toUpperCase() || "AUTO"}</span></div>
                          <p>{record.summary || "No summary returned by Maqsam."}</p>
                          <div className={styles.metaLine}><span>Call ID: {String(record.callId ?? "—")}</span><span>Reference ID: {String(record.referenceId ?? "—")}</span><span>State: {record.state || "—"}</span></div>
                          {record.tags?.length ? <div className={styles.tags}>{record.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                          {contactUrl ? <a href={contactUrl} target="_blank" rel="noreferrer"><Link2 size={14}/>Open HubSpot contact<ExternalLink size={12}/></a> : null}
                        </article>
                        <article>
                          <div className={styles.detailHeading}><h3>Transcript</h3><span>{record.transcription ? "AVAILABLE" : "MISSING"}</span></div>
                          <pre>{record.transcription || "Maqsam did not return a transcript for this call."}</pre>
                        </article>
                      </div>
                    </td></tr>}
                  </Fragment>;
                })}
                {!model.filtered.length && <tr><td colSpan={8}><div className={styles.empty}>No calls match the current filters.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </>}
    </div>
  </main>;
}
