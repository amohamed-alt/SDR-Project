"use client";
import { useState } from "react";
import { dashboardToday } from "@/lib/dashboard-values";
import type { DashboardFilters } from "@/lib/types";
import styles from "./DecisionStudio.module.css";

export function ReportingRange({ filters }: { filters: DashboardFilters }) {
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [error, setError] = useState("");
  function apply(nextFrom = from, nextTo = to) {
    if (!nextFrom || !nextTo || nextFrom > nextTo) { setError("Choose a valid date range."); return; }
    const url = new URL(window.location.href);
    url.searchParams.set("from", nextFrom); url.searchParams.set("to", nextTo);
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setFrom(nextFrom); setTo(nextTo); setError("");
  }
  return <form className={styles.range} onSubmit={event => { event.preventDefault(); apply(); }}>
    <label>From<input type="date" required value={from} max={to} onChange={event => setFrom(event.target.value)}/></label>
    <label>To<input type="date" required value={to} min={from} onChange={event => setTo(event.target.value)}/></label>
    <button type="submit">Apply dates</button>
    <button type="button" onClick={() => { const today = dashboardToday(); apply(today, today); }}>Today</button>
    <button type="button" onClick={() => { const today = dashboardToday(); const start = new Date(`${today}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 6); apply(start.toISOString().slice(0, 10), today); }}>Last 7 days</button>
    <button type="button" onClick={() => { const today = dashboardToday(); apply(today.slice(0, 7) + "-01", today); }}>This month</button>
    <span>{[filters.country, filters.persona, filters.tier, filters.originalSource, filters.latestSource].filter(Boolean).join(" · ") || "All contact cohorts"}</span>
    {filters.to < dashboardToday() ? <span role="status">Historical period · calls after {filters.to} are outside this view.</span> : null}
    {error ? <span role="alert">{error}</span> : null}
  </form>;
}
