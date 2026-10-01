"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./NetNewAccounts.module.css";
import type { learnCoverage } from "@/lib/saudi-coverage-learning";

type Report = {
  coverage: { checked: number; attempted: number; connected: number; meetingsHeld: number; both: number; futureTask: number; lastCheckedAt: string | null };
  model: ReturnType<typeof learnCoverage>;
  reviews?: { key: string; kind: string; result: { error?: string } }[];
  operations: { kind: string; state: string; count: number }[];
};
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function SaudiCoveragePanel({ unlocked, total, crmTotal, onChanged }: { unlocked: boolean; total?: number; crmTotal?: number; onChanged: () => Promise<void> }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/lead-inventory/engine", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Coverage unavailable");
      setReport(result); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Coverage unavailable"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  async function run(action: "sync" | "run") {
    if (action === "run" && !window.confirm("Process up to 2 qualified Saudi companies, enrich missing company details in Apollo and try at most three suitable people per company within separate 100/day limits, then create phone-qualified HubSpot contacts and tasks for Marita or Daniel?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/lead-inventory/engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "sync" ? { action, limit: 10 } : { action, limit: 2, confirmCredits: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Engine action failed");
      const errors = (result.results || []).filter((r: { error?: string }) => r.error).map((r: { domain: string; error: string }) => `${r.domain}: ${r.error}`);
      setNotice(action === "sync" ? `${result.synced}/${result.requested} company histories refreshed.` : `${result.pushed} companies pushed from ${result.processed} processed. ${errors.join(" · ")}`);
      if (action === "sync" && errors.length) setError(errors.join(" · "));
      await refresh(); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Engine action failed"); }
    finally { setBusy(false); }
  }
  const coverage = report?.coverage;
  return <section className={styles.coveragePanel} aria-label="Saudi company coverage and learning">
    <div className={styles.coverageHeading}><div><h2>Saudi coverage & learning</h2><p>200+ employees · 250+ priority · Talentera / Evalufy · ATS present → Daniel · direct applications → Marita · unknown → review</p></div><div className={styles.coverageActions}>
      <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
      <button type="button" disabled={!unlocked || busy} onClick={() => void run("sync")}>Sync 10 histories</button>
      <button type="button" disabled={!unlocked || busy} onClick={() => void run("run")}>{busy ? "Processing…" : "Process 2 companies"}</button>
    </div></div>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!report && !error ? <p role="status">Loading coverage…</p> : null}
    {coverage ? <>
      <div className={styles.coverageMetrics}>
        <div><span>CRM histories checked</span><strong>{coverage.checked.toLocaleString()} / {crmTotal?.toLocaleString() ?? "…"}</strong></div>
        <div><span>Connected call</span><strong>{coverage.connected.toLocaleString()}</strong></div>
        <div><span>Meeting held</span><strong>{coverage.meetingsHeld.toLocaleString()}</strong></div>
        <div><span>Both milestones</span><strong>{coverage.both.toLocaleString()} / {total?.toLocaleString() ?? "…"}</strong></div>
      </div>
      <p>Only checked HubSpot histories contribute outcomes. Unchecked companies are unknown. Counts include company and contact activities. {coverage.lastCheckedAt ? `Last sync: ${new Date(coverage.lastCheckedAt).toLocaleString()}.` : "Historical sync has not run yet."}</p>
      <details><summary>{report.model.mode === "learning" ? "Learning from outcomes" : "Collecting evidence"} · {report.model.matureCompanies} mature companies</summary>
        <p>30-day outcomes after the first SDR call; at least 20 distinct companies per segment before learned ranking applies. Untouched and recent companies are not failures. These are observed associations, not proof of causation.</p>
        {report.model.segments.length ? <div className={styles.coverageTable}><table><thead><tr><th>Product</th><th>Segment</th><th>Companies</th><th>Connected</th><th>Held meeting</th><th>95% interval</th><th>Use</th></tr></thead><tbody>{report.model.segments.slice(0, 15).map((s) => <tr key={`${s.product}:${s.dimension}:${s.value}`}><td>{s.product}</td><td>{s.dimension}: {s.value}</td><td>{s.companies}</td><td>{percent(s.connectionRate)}</td><td>{percent(s.meetingRate)}</td><td>{percent(s.lower)}–{percent(s.upper)}</td><td>{s.usable ? "Ranking" : "More evidence needed"}</td></tr>)}</tbody></table></div> : <p>No mature, product-attributed SDR outcomes yet.</p>}
        <p>Daily limits: 100 company attempts, 100 Apollo company enrichments, 100 identity matches and 100 person reveals shared across Saudi inventory actions. At most three person reveals per company. Failed or uncertain operations stay in review.</p>
        {report.reviews?.length ? <details><summary>Operations needing review ({report.reviews.length})</summary><ul>{report.reviews.map((r) => <li key={r.key}>{r.key}: {r.result.error || "Reconcile the previous operation before retrying"}</li>)}</ul></details> : null}
        {report.operations.length ? <ul>{report.operations.map((o) => <li key={`${o.kind}:${o.state}`}>{o.kind} · {o.state}: {o.count} in the last 24 hours</li>)}</ul> : null}
      </details>
    </> : null}
  </section>;
}
