"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Clock3,
  Database,
  Eye,
  RefreshCw,
  Users,
} from "lucide-react";
import styles from "@/components/TeamActivity.module.css";

type UsageUser = {
  visitorId: string;
  displayName: string;
  firstSeen: string;
  lastSeen: string;
  active: boolean;
  currentPath: string;
  currentFeature: string;
  sessionsToday: number;
  totalSessions: number;
  totalPageViews: number;
};

type UsageSummary = {
  tracking: boolean;
  database?: string;
  unavailable?: boolean;
  activeWindowSeconds?: number;
  generatedAt?: number;
  metrics: {
    activeNow: number;
    uniqueUsersToday: number;
    sessionsToday: number;
    opensToday: number;
    eventsToday: number;
    avgSessionMinutes: number;
  };
  users: UsageUser[];
  topFeatures: Array<{ feature: string; events: number; users: number }>;
};

const EMPTY: UsageSummary = {
  tracking: false,
  metrics: {
    activeNow: 0,
    uniqueUsersToday: 0,
    sessionsToday: 0,
    opensToday: 0,
    eventsToday: 0,
    avgSessionMinutes: 0,
  },
  users: [],
  topFeatures: [],
};

function labelFeature(value: string) {
  return value
    .split(/[-_/]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Dashboard";
}

function relativeTime(raw: string) {
  const value = new Date(raw).getTime();
  if (!Number.isFinite(value)) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 45) return "Now";
  if (seconds < 90) return "1m ago";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function TeamActivity({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<UsageSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  async function load() {
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      const payload = await response.json() as UsageSummary;
      setData(payload);
      setUpdatedAt(Date.now());
    } catch {
      setData({ ...EMPTY, unavailable: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeUsers = useMemo(() => data.users.filter((user) => user.active), [data.users]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.back} onClick={onBack} aria-label="Back to dashboard"><ArrowLeft size={18}/></button>
          <div>
            <span className={styles.eyebrow}>OPERATIONS · LIVE USAGE</span>
            <h1>Team Activity</h1>
            <p>See who is using the SDR workspace, how often they return, and which tools get real adoption.</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.health} ${data.tracking ? styles.healthy : styles.offline}`}>
            <span/>{data.tracking ? "PostgreSQL tracking live" : data.unavailable ? "Tracking unavailable" : "Tracking warming up"}
          </span>
          <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? styles.spinning : ""}/> Refresh
          </button>
        </div>
      </header>

      <section className={styles.metrics}>
        <article><div className={styles.metricIcon}><Activity size={18}/></div><span>Active now</span><strong>{data.metrics.activeNow}</strong><small>{activeUsers.length ? activeUsers.map((u) => u.displayName).slice(0, 3).join(", ") : "No active users"}</small></article>
        <article><div className={styles.metricIcon}><Users size={18}/></div><span>Users today</span><strong>{data.metrics.uniqueUsersToday}</strong><small>Unique browsers</small></article>
        <article><div className={styles.metricIcon}><Eye size={18}/></div><span>Dashboard opens</span><strong>{data.metrics.opensToday}</strong><small>{data.metrics.sessionsToday} sessions today</small></article>
        <article><div className={styles.metricIcon}><Clock3 size={18}/></div><span>Avg. session</span><strong>{data.metrics.avgSessionMinutes}<em>m</em></strong><small>{data.metrics.eventsToday} tracked actions</small></article>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><span>LIVE PRESENCE</span><h2>Workspace users</h2></div>
            <small>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading…"}</small>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>User</th><th>Status</th><th>Current workspace</th><th>Today</th><th>Total opens</th><th>Page views</th></tr></thead>
              <tbody>
                {data.users.length ? data.users.map((user) => (
                  <tr key={user.visitorId}>
                    <td><div className={styles.person}><span className={styles.avatar}>{user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>First seen {relativeTime(user.firstSeen)}</small></div></div></td>
                    <td><span className={`${styles.status} ${user.active ? styles.active : ""}`}><i/>{user.active ? "Active" : relativeTime(user.lastSeen)}</span></td>
                    <td><strong className={styles.feature}>{labelFeature(user.currentFeature)}</strong><small className={styles.path}>{user.currentPath}</small></td>
                    <td>{user.sessionsToday} sessions</td>
                    <td>{user.totalSessions}</td>
                    <td>{user.totalPageViews}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6}><div className={styles.empty}>{loading ? "Loading activity…" : "No usage has been recorded yet. The first visitor will appear here automatically."}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className={styles.sidePanel}>
          <div className={styles.panelHeader}><div><span>30-DAY ADOPTION</span><h2>Most used tools</h2></div><Database size={16}/></div>
          <div className={styles.featureList}>
            {data.topFeatures.length ? data.topFeatures.map((feature, index) => (
              <div className={styles.featureRow} key={feature.feature}>
                <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{labelFeature(feature.feature)}</strong><small>{feature.users} users</small></div>
                <b>{feature.events}</b>
              </div>
            )) : <div className={styles.emptySide}>Feature usage will populate as the team uses the new dashboard.</div>}
          </div>
          <div className={styles.note}>Tracking is intentionally limited to product usage: sessions, page/tool opens, active presence and actions. It does not record passwords, messages or keystrokes.</div>
        </aside>
      </section>
    </main>
  );
}
