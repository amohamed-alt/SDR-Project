"use client";
import { useState } from "react";
import type { CallGroup, CallIntelligence } from "@/lib/call-intelligence";
import type { RecordSelection } from "@/lib/dashboard-records";
import styles from "./DecisionStudio.module.css";

type Inspect = (title: string, selection: RecordSelection) => void;
export function CallSegmentTable({ title, rows, onInspect }: { title: string; rows: CallGroup[]; onInspect: Inspect }) {
  return <section className={styles.panel}><header><div><span className={styles.kicker}>Actual calling activity</span><h2>{title}</h2><p>Sorted by calls · open a segment to inspect the exact call records.</p></div></header>
    {rows.length ? <div className={styles.tableScroll}><table className={styles.ranking}><thead><tr><th>Segment</th><th>Calls</th><th>Connected</th><th>Connect %</th><th>People</th><th>With meeting</th></tr></thead><tbody>{rows.map(row => <tr key={row.value}><td><button onClick={() => onInspect(`${row.name} · calls`, row.selection)}>{row.name}</button>{row.title ? <small className={styles.contactContext}>{row.title} · {row.company}</small> : null}</td><td>{row.calls}</td><td>{row.connected}</td><td>{row.rate}%</td><td>{row.people}</td><td>{row.meetingContacts}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No calls in this period. Choose Today or extend the date range.</p>}
  </section>;
}
export function CallIntelligencePanel({ calling, timezone, onInspect }: { calling: CallIntelligence; timezone: string; onInspect: Inspect }) {
  const [dimension, setDimension] = useState<"titles" | "companies" | "contacts">("titles");
  const max = Math.max(1, ...calling.titles.map(row => row.calls));
  const hourMax = Math.max(1, ...calling.hours.map(row => row.calls));
  return <section aria-label="Call audience intelligence">
    <div className={styles.callHeading}><div><span className={styles.kicker}>Conversation intelligence</span><h2>Who are we actually calling?</h2><p>{calling.calls} calls · {calling.people} distinct people · {calling.repeatedPeople} people called more than once</p></div><span>{calling.lastCallAt ? `Latest call: ${new Date(calling.lastCallAt).toLocaleString("en-GB", { timeZone: timezone })} · ${timezone}` : "No calls logged in this period"}</span></div>
    <div className={styles.chartGrid}><section className={styles.panel}><header><div><span className={styles.kicker}>Audience mix</span><h2>Most-called job titles</h2><p>Exact CRM titles · top 8 by call volume</p></div></header><div className={styles.barList}>{calling.titles.slice(0, 8).map(row => <button key={row.value} onClick={() => onInspect(`${row.name} · calls`, row.selection)}><span><strong>{row.name}</strong><span>{row.calls} calls · {row.rate}% connected</span></span><meter aria-label={`${row.name} call volume`} min={0} max={max} value={row.calls}/></button>)}</div>{!calling.calls ? <p className={styles.empty}>No call activity in the selected dates.</p> : null}</section>
    <section className={styles.panel}><header><div><span className={styles.kicker}>Call timing</span><h2>When conversations happen</h2><p>{timezone} · attempts and connected outcomes by logged hour</p></div></header><div className={styles.hourGrid}>{Array.from({ length: 24 }, (_, hour) => { const key = String(hour).padStart(2, "0"); const row = calling.hours.find(item => item.value === key); return <button key={hour} disabled={!row} aria-label={`${key}:00 · ${row?.calls || 0} calls · ${row?.connected || 0} connected`} title={`${row?.calls || 0} calls · ${row?.connected || 0} connected`} onClick={() => row && onInspect(`${key}:00 · calls`, row.selection)}><span className={styles.hourTrack}><i style={{ height: `${(row?.calls || 0) / hourMax * 100}%` }}/><b style={{ height: `${(row?.connected || 0) / hourMax * 100}%` }}/></span><small>{key}</small></button>; })}</div><div className={styles.coverage}><span>Light green: attempts · Dark green: connected</span></div><p>{calling.titleKnownCalls} / {calling.calls} calls have a known job title. {calling.calls - calling.matchedCalls} calls have no matching profile in this portfolio.</p></section></div>
    <nav className={styles.tabs} aria-label="Call audience breakdown">{([['titles', 'Job titles'], ['companies', 'Companies'], ['contacts', 'People']] as const).map(([key, label]) => <button key={key} aria-pressed={dimension === key} onClick={() => setDimension(key)}>{label}</button>)}</nav>
    <CallSegmentTable title={dimension === "contacts" ? "People we call most" : dimension === "companies" ? "Companies we call most" : "Job title performance"} rows={calling[dimension]} onInspect={onInspect}/>
    <p className={styles.evidence}>{calling.definition}</p>
  </section>;
}
