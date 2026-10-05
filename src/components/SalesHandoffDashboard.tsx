"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, ListTodo, Phone, RefreshCw, Search, Target } from "lucide-react";
import { Drawer } from "@/components/dashboard/DashboardPrimitives";
import { HANDOFF_START_DATE, accountReviewRows, matchesReview, type HandoffReview, type ReviewBucket } from "@/lib/handoff-review";
import styles from "@/components/SalesHandoffDashboard.module.css";

type Task = { id: string; subject: string; dueAt: string; url: string };
type Row = {
  id: string; meetingId: string; meetingTitle: string; meetingDate: string; meetingEnd: string; outcome: string;
  bookedBy: { id: string; name: string }; salesRep: { id: string; name: string };
  company: { id: string; name: string; domain: string; url: string } | null;
  contacts: Array<{ id: string; name: string; email: string; phone: string; url: string }>;
  deal: { id: string; name: string; stage: string; owner: string; amount: number; isOpen: boolean; isClosedWon: boolean; createdAt: string; url: string } | null;
  dealCreatedAfterMeeting: boolean;
  nextTask: Task | null; overdueTask: Task | null; review: HandoffReview;
  attention: { level: "ok" | "warning" | "critical"; reason: string };
  recordUrl: string;
};
type Payload = {
  meta: { generatedAt: string; from: string; to: string; timezone: string; followUpThrough: string;
    excludedUnattributed: number; salesRep: { id: string; name: string };
    sdrs: Array<{ id: string; name: string }>; salesReps: Array<{ id: string; name: string }>; cache: "hit" | "miss" };
  rows: Row[];
};
const BUCKETS: Array<{ key: ReviewBucket; label: string; helper: string; icon: typeof CalendarDays }> = [
  { key: "all", label: "SDR handoff accounts", helper: "Counted once per Sales rep", icon: CalendarDays },
  { key: "noFollowUp", label: "No logged follow-up", helper: "No call, email, WhatsApp or completed meeting", icon: AlertTriangle },
  { key: "noCallAttempts", label: "No call attempts", helper: "Other follow-up channels may exist", icon: Phone },
  { key: "noConnectedCall", label: "No connected call", helper: "Includes unanswered call attempts", icon: Phone },
  { key: "noNextTask", label: "No upcoming task", helper: "No open future task assigned to Sales rep", icon: ListTodo },
  { key: "overdueTask", label: "Overdue follow-up", helper: "Open Sales task is past its due date", icon: AlertTriangle },
];
const STATE_LABELS: Record<HandoffReview["state"], string> = {
  upcoming: "Upcoming meeting", excluded: "Canceled / rescheduled", "outcome-missing": "Outcome needs review",
  "within-sla": "Within 24h window", reviewable: "Follow-up review", closed: "Closed deal", unlinked: "Missing CRM associations",
};
function today() { return new Date().toISOString().slice(0, 10); }
function dateTime(raw: string) {
  if (!raw) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(raw));
}
function shortName(row: Row) { return row.company?.name || row.contacts[0]?.name || row.meetingTitle; }
function accountKey(row: Row) { return `${row.salesRep.id}:${row.company?.id || row.contacts[0]?.id || row.deal?.id || row.id}`; }
function TaskLink({ task }: { task: Task | null }) {
  if (!task) return <span>No upcoming task</span>;
  return <a className={styles.recordLink} href={task.url} target="_blank" rel="noreferrer"><strong>{task.subject}</strong><span className={styles.secondary}>{dateTime(task.dueAt)}</span></a>;
}
export function SalesHandoffDashboard({ onBack, salesRepId = "all", from = HANDOFF_START_DATE, to = today() }: {
  onBack: () => void; salesRepId?: string; from?: string; to?: string;
}) {
  const [draft, setDraft] = useState({ from, to, salesRepId });
  const [applied, setApplied] = useState({ from, to, salesRepId });
  const [sdr, setSdr] = useState("");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [bucket, setBucket] = useState<ReviewBucket>("all");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const requestSequence = useRef(0);
  const load = useCallback(async (force = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams(applied);
      if (force) query.set("refresh", "1");
      const response = await fetch(`/api/dashboard/sales-handoff?${query}`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
      const payload = await response.json() as Payload & { error?: string; details?: string };
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load SDR handoffs");
      if (sequence === requestSequence.current) { setData(payload); setSelected(null); }
    } catch (loadError) {
      if (sequence === requestSequence.current) setError(loadError instanceof Error ? loadError.message : "Unable to load SDR handoffs");
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [applied]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); };
  }, [load]);
  const accounts = useMemo(() => accountReviewRows((data?.rows || []).filter(row => {
    if (sdr && row.bookedBy.id !== sdr) return false;
    const haystack = [shortName(row), row.salesRep.name, row.deal?.name, ...row.contacts.map(contact => contact.name)].join(" ").toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  })), [data, sdr, search]);
  const stageGroups = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const row of accounts.filter(row => row.review.eligible)) {
      const name = row.deal?.stage || "No associated deal";
      groups.set(name, [...(groups.get(name) || []), row]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [accounts]);
  const scoped = accounts.filter(row => !stage || (row.review.eligible && (row.deal?.stage || "No associated deal") === stage));
  const visibleRows = scoped.filter(row => matchesReview(row, bucket));
  const selectedHistory = selected ? (data?.rows || []).filter(row => accountKey(row) === accountKey(selected)).sort((a, b) => Date.parse(b.meetingDate) - Date.parse(a.meetingDate)) : [];
  const closeDetails = useCallback(() => setSelected(null), []);
  const reset = () => { setBucket("all"); setStage(""); setSdr(""); setSearch(""); };
  return <section className={styles.page} aria-label="GTM and SDR handoff follow-up">
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <button type="button" className={styles.back} onClick={onBack} aria-label="Back to dashboard"><ArrowLeft size={18}/></button>
        <div><span className={styles.eyebrow}>GTM / SDR → SALES · MANAGEMENT FOLLOW-UP</span><h1>SDR Handoff Follow-up</h1>
          <p>Only meetings booked by Marita or Daniel. See the current deal stage, logged Sales follow-up, call attempts and the next task.</p></div>
      </div>
      <div className={styles.headerActions}>
        {data ? <span className={styles.cacheBadge}>Updated {dateTime(data.meta.generatedAt)}</span> : null}
        <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spinning : ""}/>{loading ? "Updating" : "Refresh"}</button>
      </div>
    </header>
    <section className={styles.filters} aria-label="Report filters">
      <label className={styles.field}><span>Meeting date from</span><input type="date" min={HANDOFF_START_DATE} max={draft.to} value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })}/></label>
      <label className={styles.field}><span>Meeting date to</span><input type="date" min={draft.from} max={today()} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })}/></label>
      <label className={`${styles.field} ${styles.fieldWide}`}><span>Sales rep</span><select value={draft.salesRepId} onChange={event => setDraft({ ...draft, salesRepId: event.target.value })}><option value="all">Ursula + Zein</option>{(data?.meta.salesReps || [{ id: "76369997", name: "Ursula Waked" }, { id: "31558980", name: "Zein Fares" }]).map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select></label>
      <label className={styles.field}><span>Booked by</span><select value={sdr} onChange={event => setSdr(event.target.value)}><option value="">Marita + Daniel</option>{data?.meta.sdrs.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label className={`${styles.field} ${styles.fieldWide}`}><span>Search account / contact</span><input type="search" value={search} placeholder="Company, contact or deal" onChange={event => setSearch(event.target.value)}/></label>
      <div className={styles.filterActions}><button type="button" className={styles.reset} onClick={reset}>Clear filters</button><button type="button" className={styles.apply} disabled={loading || draft.from > draft.to || draft.from < HANDOFF_START_DATE} onClick={() => { reset(); setApplied({ ...draft }); }}><Search size={14}/>Apply dates / rep</button></div>
    </section>
    {error ? <div className={styles.error} role="alert"><AlertTriangle size={18}/><div><strong>{data ? "Refresh failed; showing the previous report" : "Report could not load"}</strong><div>{error}</div></div></div> : null}
    {loading && !data ? <div className={styles.loading} role="status"><RefreshCw className={styles.spinning}/><strong>Loading SDR handoff follow-up…</strong><span>Reading verified bookings and associated Sales activities.</span></div> : null}
    {data ? <>
      <p className={styles.scopeNote}>Meeting cohort: {data.meta.from} to {data.meta.to}. Sales activities checked through {data.meta.followUpThrough}. Counts are accounts, once per Sales rep, based on their latest past SDR meeting. An account may appear in multiple gap cards. Risk cards cover completed / no-show meetings more than 24h old with no closed deal. Missing associations and outcomes need review; future and canceled meetings are excluded from follow-up gaps.</p>
      <section className={styles.metrics} aria-label="Management follow-up cards">{BUCKETS.map(({ key, label, helper, icon: Icon }) => {
        const count = scoped.filter(row => matchesReview(row, key)).length;
        return <button type="button" aria-pressed={bucket === key} className={`${styles.metric} ${styles.metricButton} ${bucket === key ? styles.selectedMetric : ""}`} key={key} onClick={() => setBucket(key)}><div className={styles.metricTop}><span>{label}</span><Icon size={16}/></div><strong>{count}</strong><small>{helper} · View accounts</small></button>;
      })}</section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><span>CURRENT DEAL STAGE</span><h2>Where follow-up is missing</h2></div><button type="button" className={styles.reset} onClick={() => { setStage(""); setBucket("all"); }}>Show all stages</button></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Deal stage</th><th>Accounts</th><th>No follow-up</th><th>No call attempts</th><th>No connected call</th><th>No upcoming task</th><th>Overdue task</th></tr></thead><tbody>
          {stageGroups.length ? stageGroups.map(([name, rows]) => <tr key={name}><td><button type="button" className={styles.detailButton} onClick={() => { setStage(name); setBucket("all"); }}>{name}</button></td>{(["all", "noFollowUp", "noCallAttempts", "noConnectedCall", "noNextTask", "overdueTask"] as ReviewBucket[]).map(key => <td key={key}><button type="button" className={styles.countButton} aria-label={`${name}: ${key}`} onClick={() => { setStage(name); setBucket(key); }}>{rows.filter(row => matchesReview(row, key)).length}</button></td>)}</tr>) : <tr><td colSpan={7}>No meetings eligible for follow-up review in this cohort.</td></tr>}
        </tbody></table></div>
      </section>
      <section className={`${styles.panel} ${styles.tablePanel}`}>
        <div className={styles.tableToolbar}><div><h2>{BUCKETS.find(item => item.key === bucket)?.label || "Accounts"}{stage ? ` · ${stage}` : ""}</h2><p>Click an account for meeting history, activity evidence and HubSpot links.</p></div><span className={styles.count}>{visibleRows.length} account handoffs · {data.rows.length} SDR meetings</span></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Account / Sales rep</th><th>SDR meeting</th><th>Deal stage</th><th>Call attempts / connected</th><th>Last Sales follow-up</th><th>Next task</th><th>Review</th></tr></thead><tbody>
          {visibleRows.length ? visibleRows.map(row => <tr key={`${row.salesRep.id}:${row.id}`}>
            <td><button type="button" className={styles.detailButton} onClick={() => setSelected(row)}>{shortName(row)}</button><span className={styles.secondary}>{row.salesRep.name} · {row.contacts[0]?.name || "No linked contact"}</span></td>
            <td><span className={styles.primary}>{dateTime(row.meetingDate)}</span><span className={styles.secondary}>{row.bookedBy.name} · {row.outcome}</span></td>
            <td>{row.deal ? <a className={styles.recordLink} href={row.deal.url} target="_blank" rel="noreferrer"><strong>{row.deal.stage}</strong><span className={styles.secondary}>{row.deal.name}</span></a> : "No associated deal"}</td>
            <td><strong>{row.review.callAttempts} attempts / {row.review.connectedCalls} connected</strong></td>
            <td>{row.review.events.length ? <><span className={styles.primary}>{dateTime(row.review.events.at(-1)!.at)}</span><span className={styles.secondary}>{row.review.events.at(-1)!.type}</span></> : "No logged activity"}</td>
            <td><TaskLink task={row.nextTask}/>{row.overdueTask ? <span className={`${styles.badge} ${styles.warning}`}>Overdue task</span> : null}</td>
            <td><span className={`${styles.badge} ${row.attention.level === "critical" ? styles.critical : row.attention.level === "warning" ? styles.warning : styles.good}`}>{row.attention.reason}</span><button type="button" className={styles.detailButton} onClick={() => setSelected(row)}>View detail</button></td>
          </tr>) : <tr><td colSpan={7}><div className={styles.empty}><Target size={22}/><span>No accounts match these filters.</span></div></td></tr>}
        </tbody></table></div>
      </section>
      <p className={styles.scopeNote}>{data.meta.excludedUnattributed} other Sales meetings excluded because Marita / Daniel booking attribution could not be verified. No connected call does not mean no effort; inspect attempts and other channels. Deal stages are current associated records, not proof that GTM generated the deal.</p>
    </> : null}
    <Drawer open={Boolean(selected)} onClose={closeDetails} title={selected ? shortName(selected) : "Account detail"} description="Verified SDR meeting history and logged follow-up by the selected Sales rep">
      {selected ? <>
        <div className={styles.detailSection}><h3>{selected.salesRep.name} · {STATE_LABELS[selected.review.state]}</h3><p>{selected.attention.reason}</p><p>Latest SDR handoff: {selected.bookedBy.name} · {dateTime(selected.meetingDate)} · {selected.outcome}</p>
          {selected.company?.url ? <a href={selected.company.url} target="_blank" rel="noreferrer">Open company in HubSpot</a> : null}
          {selected.contacts.map(contact => <p key={contact.id}><a href={contact.url} target="_blank" rel="noreferrer">{contact.name} · Open contact timeline</a><span className={styles.secondary}>{contact.email} · {contact.phone}</span></p>)}
          {selected.deal ? <p><a href={selected.deal.url} target="_blank" rel="noreferrer">{selected.deal.name} · {selected.deal.stage} · {selected.deal.owner}</a><span className={styles.secondary}>{selected.dealCreatedAfterMeeting ? "Associated deal created after the meeting" : "Pre-existing associated deal; not credited as a new GTM deal"}</span></p> : <p>No associated deal found.</p>}
        </div>
        <div className={styles.detailSection}><h3>Follow-up tasks</h3><TaskLink task={selected.nextTask}/>{selected.overdueTask ? <p>Overdue: <TaskLink task={selected.overdueTask}/></p> : null}</div>
        <div className={styles.detailSection}><h3>Sales activity after this SDR meeting</h3><p>{selected.review.callAttempts} call attempts · {selected.review.connectedCalls} connected. Other Sales meetings are evidence only and never create a new SDR handoff cohort.</p>
          {selected.review.events.length ? <ol className={styles.evidenceList}>{selected.review.events.map(event => <li key={`${event.type}:${event.id}`}><a href={event.url} target="_blank" rel="noreferrer"><strong>{event.type} · {event.connected ? "Connected" : event.outcome || "Logged activity"}</strong><span>{dateTime(event.at)} · {event.detail}</span></a></li>)}</ol> : <p>No associated Sales follow-up is logged after this meeting.</p>}
        </div>
        <div className={styles.detailSection}><h3>All SDR meetings for this account / Sales rep</h3><ol className={styles.evidenceList}>{selectedHistory.map(row => <li key={row.id}><a href={row.recordUrl} target="_blank" rel="noreferrer"><strong>{row.bookedBy.name} · {row.outcome}</strong><span>{dateTime(row.meetingDate)} · {row.meetingTitle}</span></a></li>)}</ol></div>
      </> : null}
    </Drawer>
  </section>;
}
