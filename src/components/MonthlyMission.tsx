"use client";

import { Target } from "lucide-react";
import { useMeetingSheet } from "@/hooks/use-meeting-sheet";
import { dashboardToday } from "@/lib/dashboard-values";
import { monthlyPacing } from "@/lib/meeting-performance";
import { SDR_OWNERS, type SdrKey } from "@/lib/sdr-owners";
import type { DashboardData } from "@/lib/types";
import styles from "./MonthlyMission.module.css";
import { DashboardDisclosure } from "./DashboardDisclosure";

export function MonthlyMission({ sdr, data, refreshKey = 0, compact = false }: { sdr: SdrKey; data: {meta: Pick<DashboardData["meta"], "to" | "isDemo">}; refreshKey?: number; compact?: boolean }) {
  const month = data.meta.to.slice(0, 7);
  const today = dashboardToday();
  const last = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).toISOString().slice(0,10);
  const to = last < today ? last : today;
  const from = `${month}-01`;
  const supported = sdr === "marita" || sdr === "daniel";
  const monthly = useMeetingSheet(SDR_OWNERS[sdr].ownerId, from, last, refreshKey, supported && !data.meta.isDemo);
  const snapshot = monthly.data;
  const performance = snapshot?.performance;
  const pacing = monthlyPacing(month, to);
  if (!supported) return null;
  const missions = sdr === "marita" ? [{ label:"Inbound", target:20, actual:performance?.inbound, color:"#35d6a0" }, { label:"Outbound", target:20, actual:performance?.outbound, color:"#ba9aff" }] : [{label:"Outbound", target:50, actual:performance?.outbound, color:"#ba9aff"}];
  return <section className={`${styles.mission} ${compact ? styles.compact : ""}`} aria-label={`${SDR_OWNERS[sdr].shortName} monthly meeting targets`}>
    <header className={styles.intro}><span><Target size={16}/> Monthly goals</span><p>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {month:"long",year:"numeric"})} · {SDR_OWNERS[sdr].shortName}</p></header>
    <div className={styles.goals}>{missions.map(goal => {
      const actual = goal.actual;
      const expected = Math.ceil(goal.target*pacing.fraction);
      return <div key={`${sdr}-${goal.label}-${month}`} className={styles.goal}>
        <div className={styles.goalHeader}><strong>{goal.label}</strong><span>{actual ?? "—"} / {goal.target}</span></div>
        <progress max={goal.target} value={actual === undefined ? undefined : Math.min(actual, goal.target)} aria-label={`${goal.label}: ${actual ?? "unavailable"} of ${goal.target} meetings`}/>
        <small>{actual === undefined ? "Waiting for meeting tracker" : `${Math.round(actual/goal.target*100)}% achieved · ${Math.max(0,goal.target-actual)} to go`}</small>
        <small>{actual === undefined ? "Progress unavailable" : actual >= expected ? "On pace" : `${expected-actual} behind pace`} · expected {expected}</small>
      </div>;
    })}</div>
    <p className={styles.scope}>Google Sheet · includes meetings scheduled later this month</p>
    {monthly.error || snapshot?.status === "unavailable" ? <p className={styles.notice} role="alert">Tracker unavailable: {monthly.error || snapshot?.error}</p> : !performance ? <p className={styles.scope}>{data.meta.isDemo ? "Live sheet goals are unavailable in demo mode." : "Loading meeting tracker…"}</p> : null}
    <DashboardDisclosure title={`Source & pacing details${snapshot?.warnings.length ? ` · ${snapshot.warnings.length} notices` : ""}`}>
      <p>{pacing.elapsed} / {pacing.total} working days elapsed · Sun–Thu pacing.</p>
      {performance ? <p>{performance.held} attended · {performance.upcoming} upcoming · {performance.canceled + performance.rescheduled} canceled / rescheduled excluded from targets · {performance.unknown} unknown source</p> : null}
      {snapshot ? <p>Synced {snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString("en-GB") : "—"} · <a href={snapshot.url} target="_blank" rel="noreferrer">Open source sheet ↗</a></p> : null}
      {snapshot?.warnings.length ? <ul>{snapshot.warnings.map((warning,index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul> : null}
    </DashboardDisclosure>
  </section>;
}
