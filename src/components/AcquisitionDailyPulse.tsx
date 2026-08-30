"use client";

import { useMemo } from "react";
import type { Drilldown } from "@/components/DrilldownDrawer";
import type { ActivityRow, DailyActivityDatum, DashboardData } from "@/lib/types";
import styles from "@/components/AcquisitionDashboard.module.css";

type Pace = {
  label: "Strong" | "On pace" | "Light" | "No activity" | "Active";
  className: string;
};

type PulseDay = {
  datum: DailyActivityDatum;
  touches: number;
  outcomes: number;
  connectionRate: number;
  pace: Pace;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T12:00:00Z`));
}

function zonedDay(value: string, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function touchesFor(day: DailyActivityDatum) {
  return day.calls + day.emailsSent + day.whatsAppMessages + day.tasksCompleted;
}

function outcomesFor(day: DailyActivityDatum) {
  return day.connected + day.meetingsBooked;
}

function paceFor(touches: number, baselineAverage: number): Pace {
  if (touches === 0) return { label: "No activity", className: styles.none };
  if (baselineAverage <= 0) return { label: "Active", className: styles.onPace };

  const ratio = touches / baselineAverage;
  if (ratio >= 1.2) return { label: "Strong", className: styles.strong };
  if (ratio >= 0.75) return { label: "On pace", className: styles.onPace };
  return { label: "Light", className: styles.light };
}

function activityRowsForDay(data: DashboardData, date: string) {
  return data.recentActivities.filter((row: ActivityRow) => {
    const metricDate = zonedDay(row.metricAt || row.occurredAt || row.dueAt, data.meta.timezone);
    return metricDate === date;
  });
}

export function AcquisitionDailyPulse({
  data,
  ownerName,
  onOpen,
}: {
  data: DashboardData;
  ownerName: string;
  onOpen: (drilldown: Drilldown) => void;
}) {
  const days = useMemo<PulseDay[]>(() => {
    const sorted = [...data.dailyActivities]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 7);

    const baselineDays = sorted.slice(1).filter((day) => touchesFor(day) > 0);
    const baselineAverage = baselineDays.length
      ? baselineDays.reduce((sum, day) => sum + touchesFor(day), 0) / baselineDays.length
      : 0;

    return sorted.map((datum) => {
      const touches = touchesFor(datum);
      const outcomes = outcomesFor(datum);
      return {
        datum,
        touches,
        outcomes,
        connectionRate: datum.calls ? Math.round((datum.connected / datum.calls) * 1000) / 10 : 0,
        pace: paceFor(touches, baselineAverage),
      };
    });
  }, [data.dailyActivities]);

  const latest = days[0];
  const baseline = useMemo(() => {
    const prior = days.slice(1).filter((day) => day.touches > 0);
    return prior.length ? prior.reduce((sum, day) => sum + day.touches, 0) / prior.length : 0;
  }, [days]);

  const latestVsAverage = latest && baseline > 0
    ? Math.round(((latest.touches - baseline) / baseline) * 100)
    : null;

  function openDay(day: PulseDay) {
    const rows = activityRowsForDay(data, day.datum.date);
    onOpen({
      kind: "activities",
      title: `${ownerName} · ${shortDate(day.datum.date)}`,
      description: `Daily activity detail: ${day.touches} touches, ${day.outcomes} outcomes, ${day.connectionRate}% connection rate.`,
      rows,
      hubspotUrl: "#",
    });
  }

  return <section className={styles.dailyPulse}>
    <div className={styles.pulseHeader}>
      <div>
        <h2>Daily Activity Pulse</h2>
        <p>Last 7 days · calls, connected calls, meetings, WhatsApp, emails and task execution. Click any day for the records behind it.</p>
      </div>
      <div className={styles.pulseLegend}>Pace is relative to this rep&apos;s recent active-day average.</div>
    </div>

    {latest ? <div className={styles.summaryGrid}>
      <div className={styles.summaryCard}>
        <span>Latest day touches</span>
        <strong>{formatNumber(latest.touches)}</strong>
        <small>{latestVsAverage === null ? "Recent baseline building" : `${latestVsAverage >= 0 ? "+" : ""}${latestVsAverage}% vs recent avg`}</small>
      </div>
      <div className={styles.summaryCard}>
        <span>Latest day outcomes</span>
        <strong>{formatNumber(latest.outcomes)}</strong>
        <small>{latest.datum.connected} connected · {latest.datum.meetingsBooked} meetings</small>
      </div>
      <div className={styles.summaryCard}>
        <span>Connection rate</span>
        <strong>{latest.connectionRate}%</strong>
        <small>{latest.datum.connected} connected / {latest.datum.calls} calls</small>
      </div>
      <div className={styles.summaryCard}>
        <span>Task execution</span>
        <strong>{formatNumber(latest.datum.tasksCompleted)}</strong>
        <small>{latest.datum.tasksDue} tasks due that day</small>
      </div>
    </div> : null}

    {days.length ? <div className={styles.dayList}>
      {days.map((day) => (
        <button key={day.datum.date} type="button" className={styles.dayRow} onClick={() => openDay(day)}>
          <div className={styles.dayIdentity}>
            <span className={`${styles.pulseDot} ${day.pace.className}`}/>
            <div>
              <strong>{shortDate(day.datum.date)}</strong>
              <small>{day.pace.label} · {day.touches} touches · {day.outcomes} outcomes</small>
            </div>
          </div>
          <div className={styles.dayMetric}><span>Calls</span><strong>{day.datum.calls}</strong></div>
          <div className={styles.dayMetric}><span>Connected</span><strong>{day.datum.connected}</strong></div>
          <div className={styles.dayMetric}><span>Meetings</span><strong>{day.datum.meetingsBooked}</strong></div>
          <div className={styles.dayMetric}><span>WhatsApp</span><strong>{day.datum.whatsAppMessages}</strong></div>
          <div className={styles.dayMetric}><span>Tasks done</span><strong>{day.datum.tasksCompleted}</strong></div>
          <div className={styles.dayMetric}><span>Emails</span><strong>{day.datum.emailsSent}</strong></div>
        </button>
      ))}
    </div> : <div className={styles.emptyPulse}>No daily activity is available for this reporting period.</div>}
  </section>;
}
