"use client";
import { useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData } from "@/lib/types";
import type { RecordSelection } from "@/lib/dashboard-records";
import styles from "./DecisionStudio.module.css";

const outcomeLabel = (name: string) => /^[a-f\d]{32}$/i.test(name.replace(/[\s-]/g, "")) ? "Unmapped outcome" : name;

export function PerformanceCharts({ data, onInspect }: { data: DashboardData; onInspect: (title: string, selection: RecordSelection) => void }) {
  const [series, setSeries] = useState<"calls" | "meetingsBooked">("calls");
  const [outcome, setOutcome] = useState<"Call" | "Meeting">("Call");
  const outcomes = (outcome === "Call" ? data.callOutcomes : data.meetingOutcomes).map(row => ({ ...row, displayName: outcomeLabel(row.name) }));
  const days = data.dailyActivities;
  return <div className={styles.chartGrid}>
    <section className={`${styles.panel} ${styles.trend}`} aria-label="Activity trend">
      <header><div><span className={styles.kicker}>Execution rhythm</span><h2>Activity over time</h2><p>Daily counts in the selected period · {data.meta.timezone}</p></div><div className={styles.segmented}><button type="button" aria-pressed={series === "calls"} onClick={() => setSeries("calls")}>Calls</button><button type="button" aria-pressed={series === "meetingsBooked"} onClick={() => setSeries("meetingsBooked")}>Meetings</button></div></header>
      {days.length ? <div className={styles.chart}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={days} margin={{ top: 15, right: 10, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4"/><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={35} tick={{ fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip/><Legend/><Area isAnimationActive={false} type="monotone" dataKey={series} name={series === "calls" ? "Calls" : "Meetings booked"} fill="var(--green)" fillOpacity={0.09} stroke="var(--green)" strokeWidth={2.5}/>{series === "calls" ? <Line isAnimationActive={false} type="monotone" dataKey="connected" name="Connected calls" stroke="#b77720" strokeWidth={2} dot={days.length < 15}/> : null}</ComposedChart></ResponsiveContainer></div> : <p className={styles.empty}>No activity in this period.</p>}
      <details className={styles.evidence}><summary>Explore daily records</summary><div className={styles.dayButtons}>{days.map(day => <button key={day.date} type="button" onClick={() => onInspect(`${day.date} · ${series === "calls" ? "Calls" : "Meetings"}`, { kind: "activities", day: day.date, where: [{ field: "type", value: series === "calls" ? "Call" : "Meeting" }] })}>{day.date}<strong>{day[series]}</strong></button>)}</div></details>
    </section>
    <section className={styles.panel} aria-label="Outcome mix">
      <header><div><span className={styles.kicker}>Quality of activity</span><h2>Outcome mix</h2></div><select aria-label="Outcome activity" value={outcome} onChange={event => setOutcome(event.target.value as "Call" | "Meeting")}><option>Call</option><option>Meeting</option></select></header>
      {outcomes.length ? <><div className={styles.chart}><ResponsiveContainer width="100%" height="100%"><BarChart data={outcomes.slice(0, 6)} layout="vertical" margin={{ left: 0, right: 18 }}><CartesianGrid horizontal={false} stroke="var(--border)"/><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }}/><YAxis type="category" dataKey="displayName" width={100} tick={{ fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip/><Bar isAnimationActive={false} dataKey="value" name="Records" fill="var(--green)" radius={[0, 4, 4, 0]}/></BarChart></ResponsiveContainer></div><div className={styles.outcomes}>{outcomes.map(row => <button key={row.name} onClick={() => onInspect(`${outcome} · ${row.displayName}`, { kind: "activities", outcome: row.name, where: [{ field: "type", value: outcome }] })} title={row.name !== row.displayName ? "The source outcome has no readable label; inspect its records." : undefined}>{row.displayName}<b>{row.value}</b></button>)}</div></> : <p className={styles.empty}>No {outcome.toLowerCase()} outcomes for these filters.</p>}
    </section>
    <section className={styles.panel} aria-label="Pipeline distribution">
      <header><div><span className={styles.kicker}>Opportunity mix</span><h2>Deals by stage</h2><p>Associated deal counts · current snapshot</p></div></header>
      {data.dealStages.length ? <div className={styles.barList}>{data.dealStages.map(stage => <button key={stage.name} type="button" onClick={() => onInspect(`Deals · ${stage.name}`, { kind: "deals", where: [{ field: "stage", value: stage.name }] })}><span>{stage.name}<b>{stage.value}</b></span><meter min={0} max={Math.max(1, ...data.dealStages.map(item => item.value))} value={stage.value}>{stage.value}</meter></button>)}</div> : <p className={styles.empty}>No associated deals in this scope.</p>}
    </section>
    <section className={styles.panel} aria-label="Follow-up workload">
      <header><div><span className={styles.kicker}>Follow-through</span><h2>Where attention is needed</h2><p>Current open tasks and deal risks may overlap.</p></div></header>
      <div className={styles.barList}>{[
        { name: "Overdue tasks", value: data.kpis.overdueTasks, selection: { kind: "activities", alert: "overdue" } },
        { name: "Meeting follow-up gaps", value: data.intelligence.meetingsWithoutFollowUp.count, selection: { kind: "activities", signal: "meetingsWithoutFollowUp" } },
        { name: "Stale deals", value: data.intelligence.staleDeals.count, selection: { kind: "deals", signal: "staleDeals" } },
        { name: "Deals without a next date", value: data.intelligence.dealsWithoutFutureActivity.count, selection: { kind: "deals", signal: "dealsWithoutFutureActivity" } },
      ].map(item => <button key={item.name} type="button" onClick={() => onInspect(item.name, item.selection as RecordSelection)}><span>{item.name}<b>{item.value}</b></span><meter className={styles.riskMeter} min={0} max={Math.max(1, data.kpis.overdueTasks, data.intelligence.meetingsWithoutFollowUp.count, data.intelligence.staleDeals.count, data.intelligence.dealsWithoutFutureActivity.count)} value={item.value}>{item.value}</meter></button>)}</div>
    </section>
  </div>;
}
