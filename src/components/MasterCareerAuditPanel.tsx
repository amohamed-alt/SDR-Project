"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Download, RefreshCw, Search, ShieldCheck } from "lucide-react";
import styles from "@/components/MasterCareerAuditPanel.module.css";

interface MasterAuditState {
  campaign: string;
  status: "idle" | "running" | "completed" | "error";
  total: number;
  completed: number;
  remaining: number;
  updatedVerified: number;
  unchangedVerified: number;
  manualReview: number;
  unresolved: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string;
  lastCompanyId: string;
  lastCompanyName: string;
  error: string;
  csvReady: boolean;
  downloadReady?: boolean;
  activeInProcess?: boolean;
}

function formatDate(value: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(status: MasterAuditState["status"]) {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  if (status === "error") return "Needs attention";
  return "Waiting to start";
}

export function MasterCareerAuditPanel() {
  const [audit, setAudit] = useState<MasterAuditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/career-audit", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load master audit status");
      setAudit(payload as MasterAuditState);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load master audit status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const progress = useMemo(() => {
    if (!audit?.total) return 0;
    return Math.max(0, Math.min(100, Math.round((audit.completed / audit.total) * 1000) / 10));
  }, [audit]);

  const isReady = Boolean(audit?.csvReady || audit?.downloadReady);
  const status = audit?.status || "idle";

  return <section className={styles.panel}>
    <div className={styles.header}>
      <div>
        <div className={styles.eyebrow}><ShieldCheck size={15}/>Master Career + ATS Audit</div>
        <h2>Full portfolio re-verification</h2>
        <p>Live progress for the export-only audit that is rechecking existing Career Page and ATS data before the final HubSpot import.</p>
      </div>
      <div className={styles.headerActions}>
        <span className={`${styles.status} ${styles[status]}`}>
          {status === "completed" ? <CheckCircle2 size={14}/> : status === "error" ? <CircleAlert size={14}/> : <Search size={14}/>}
          {statusLabel(status)}
        </span>
        <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? styles.spin : ""}/>Refresh</button>
        {isReady && <a href="/api/career-audit?download=1"><Download size={14}/>Download Master CSV</a>}
      </div>
    </div>

    <div className={styles.progressHeader}>
      <strong>{audit ? `${audit.completed.toLocaleString()} / ${audit.total.toLocaleString()}` : "Loading…"}</strong>
      <span>{progress}% complete</span>
    </div>
    <div className={styles.progressTrack}><i style={{ width: `${progress}%` }}/></div>

    <div className={styles.metrics}>
      <div><span>Checked</span><strong>{audit?.completed.toLocaleString() ?? "—"}</strong></div>
      <div><span>Remaining</span><strong>{audit?.remaining.toLocaleString() ?? "—"}</strong></div>
      <div><span>Updated verified</span><strong>{audit?.updatedVerified.toLocaleString() ?? "—"}</strong></div>
      <div><span>Verified unchanged</span><strong>{audit?.unchangedVerified.toLocaleString() ?? "—"}</strong></div>
      <div><span>Manual review</span><strong>{audit?.manualReview.toLocaleString() ?? "—"}</strong></div>
      <div><span>Unresolved</span><strong>{audit?.unresolved.toLocaleString() ?? "—"}</strong></div>
    </div>

    <div className={styles.footer}>
      <span>Last checked: <strong>{formatDate(audit?.updatedAt || "")}</strong></span>
      <span>Last company: <strong>{audit?.lastCompanyName || "—"}</strong></span>
      <span>CSV: <strong>{isReady ? "Ready" : "Not ready yet"}</strong></span>
    </div>

    {(error || audit?.error) && <div className={styles.error}><CircleAlert size={14}/><span>{error || audit?.error}</span></div>}
  </section>;
}
