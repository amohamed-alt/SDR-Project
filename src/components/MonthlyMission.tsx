"use client";

import { motion, useReducedMotion } from "motion/react";
import { Target, TrendingUp } from "lucide-react";
import { useDashboard } from "@/hooks/use-dashboard";
import { dashboardToday } from "@/lib/dashboard-values";
import { monthlyPacing } from "@/lib/meeting-performance";
import { SDR_OWNERS, type SdrKey } from "@/lib/sdr-owners";
import type { DashboardData } from "@/lib/types";
import styles from "./MonthlyMission.module.css";

export function MonthlyMission({ sdr, data, refreshKey = 0, compact = false }: { sdr: SdrKey; data: {meta: Pick<DashboardData["meta"], "to" | "isDemo">}; refreshKey?: number; compact?: boolean }) {
  const reduced = useReducedMotion();
  const month = data.meta.to.slice(0, 7);
  const today = dashboardToday();
  const last = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).toISOString().slice(0,10);
  const to = last < today ? last : today;
  const from = `${month}-01`;
  const supported = sdr === "marita" || sdr === "daniel";
  const monthly = useDashboard({ from, to: to < from ? from : to, ownerId: SDR_OWNERS[sdr].ownerId }, refreshKey, supported && from <= today, "summary");
  const snapshot = monthly.data;
  const performance = snapshot?.meetingPerformance;
  const pacing = monthlyPacing(month, to);
  if (!supported) return null;
  const missions = sdr === "marita" ? [{ label:"Inbound", target:20, actual:performance?.inbound, color:"#35d6a0" }, { label:"Outbound", target:20, actual:performance?.outbound, color:"#ba9aff" }] : [{label:"Outbound", target:50, actual:performance?.outbound, color:"#ba9aff"}];
  return <section className={`${styles.mission} ${compact ? styles.compact : ""}`} aria-label={`${SDR_OWNERS[sdr].shortName} monthly meeting targets`}>
    <div className={styles.intro}><span className={styles.eyebrow}><Target size={15}/> MONTHLY MISSION</span><h2>{compact ? "Monthly meeting goals" : "Every meeting moves us forward."}</h2><p>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", {month:"long",year:"numeric"})} · {SDR_OWNERS[sdr].shortName}</p><span className={styles.schedule}><TrendingUp size={15}/>{pacing.elapsed} / {pacing.total} working days elapsed</span><small>Month-to-date bookings · Sun–Thu pacing<br/>Explicit acquisition source. Backfilled outcomes excluded.</small>{data.meta.isDemo && <small>DEMO DATA · illustration only</small>}</div>
    <div className={styles.goals}>{missions.map((goal,index) => {
      const actual = goal.actual;
      const fraction = actual === undefined ? 0 : Math.min(1,actual/goal.target);
      const expected = Math.ceil(goal.target*pacing.fraction);
      return <motion.div key={`${sdr}-${goal.label}-${month}`} className={styles.goal} initial={reduced ? false : {opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:.45,delay:index*.12}}>
        <div className={styles.dial} role="img" aria-label={`${goal.label}: ${actual ?? "unavailable"} of ${goal.target} meetings`}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="7"/><motion.circle cx="60" cy="60" r="50" fill="none" stroke={goal.color} strokeWidth="7" strokeLinecap="round" transform="rotate(-90 60 60)" strokeDasharray={Math.PI*100} initial={reduced ? false : {strokeDashoffset:Math.PI*100}} animate={{strokeDashoffset:Math.PI*100*(1-fraction)}} transition={{duration:reduced ? 0 : 1.15,ease:[.22,1,.36,1]}}/></svg>
          <div><strong>{actual ?? "—"}</strong><span>/ {goal.target}</span></div>
        </div><h3>{goal.label}</h3><p>{actual === undefined ? "Waiting for complete snapshot" : `${Math.round(actual/goal.target*100)}% achieved · ${Math.max(0,goal.target-actual)} to go`}</p><span className={styles.pace}>{actual === undefined ? "Progress unavailable" : actual >= expected ? "On pace" : `${expected-actual} behind pace`} · expected {expected}</span>
      </motion.div>;
    })}</div>
    <div className={styles.foot}>{monthly.error ? <span role="alert">Targets unavailable: {monthly.error}</span> : performance ? <><span>{performance.held} held · {performance.upcoming} upcoming</span><span>{performance.unknown} unknown source · {performance.backfilled} backfilled records excluded</span></> : <span>{snapshot?.meta.isDemo ? "Target classification is unavailable in this demo snapshot." : "Loading verified monthly totals…"}</span>}{snapshot?.meta.warnings.length ? <span role="alert">Partial data: {snapshot.meta.warnings.join(" · ")}</span> : null}</div>
  </section>;
}
