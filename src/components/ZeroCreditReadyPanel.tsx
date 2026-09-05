"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, CircleAlert, Coins, Send, ShieldCheck, UsersRound } from "lucide-react";
import styles from "./ZeroCreditReadyPanel.module.css";

type ReadyAccount = {
  domain: string;
  name: string;
  country: string;
  gtmTier: string;
  gtmScore: number;
  peopleCount: number;
  enrichedCount: number;
  phoneReadyCount: number;
  ready: boolean;
};

type ReadyPayload = {
  zeroCreditMode: boolean;
  summary: { stored: number; ready: number; needsPeople: number; searchOnly: number; pushed: number };
  accounts: ReadyAccount[];
  error?: string;
};

export function ZeroCreditReadyPanel() {
  const [payload, setPayload] = useState<ReadyPayload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/acquisition/zero-credit-ready", { cache: "no-store" });
      const data = await response.json() as ReadyPayload;
      if (!response.ok) throw new Error(data.error || "Unable to load ready queue.");
      setPayload(data);
      setSelected((current) => current.filter((domain) => data.accounts.some((account) => account.domain === domain && account.ready)));
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load ready queue.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const ready = useMemo(
    () => (payload?.accounts || []).filter((account) => account.ready).sort((a, b) => b.gtmScore - a.gtmScore || a.name.localeCompare(b.name)),
    [payload],
  );

  async function pushSelected() {
    if (!selected.length || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    let pushed = 0;
    let duplicates = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (let index = 0; index < selected.length; index += 50) {
        const response = await fetch("/api/acquisition/zero-credit-ready", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "push_ready", domains: selected.slice(index, index + 50) }),
        });
        const result = await response.json() as { pushed?: number; duplicates?: number; skipped?: number; failed?: number; error?: string };
        if (!response.ok) throw new Error(result.error || `Ready push failed (${response.status}).`);
        pushed += Number(result.pushed || 0);
        duplicates += Number(result.duplicates || 0);
        skipped += Number(result.skipped || 0);
        failed += Number(result.failed || 0);
      }
      setMessage(`${pushed} pushed · ${duplicates} duplicates · ${skipped} skipped · ${failed} failed · 0 SignalHire/Apollo data credits`);
      setSelected([]);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ready push failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.panel}>
    <div className={styles.head}>
      <div>
        <span className={styles.kicker}><ShieldCheck size={13}/> SIGNALHIRE CREDIT GUARD</span>
        <h3>Select All Ready</h3>
        <p>Only contacts already enriched and stored in Postgres can be pushed from here. No Apollo search and no SignalHire contact reveal runs from this panel.</p>
      </div>
      <div className={styles.guard}><Coins size={16}/><strong>0</strong><span>data credits per push</span></div>
    </div>

    <div className={styles.metrics}>
      <article><BadgeCheck size={14}/><span>Ready</span><strong>{payload?.summary.ready ?? "—"}</strong></article>
      <article><UsersRound size={14}/><span>Needs people</span><strong>{payload?.summary.needsPeople ?? "—"}</strong></article>
      <article><CircleAlert size={14}/><span>Search-only</span><strong>{payload?.summary.searchOnly ?? "—"}</strong></article>
      <article><Send size={14}/><span>Pushed</span><strong>{payload?.summary.pushed ?? "—"}</strong></article>
    </div>

    <div className={styles.actions}>
      <button type="button" onClick={() => setSelected(ready.map((account) => account.domain))} disabled={!ready.length || busy}>Select all ready ({ready.length})</button>
      <button type="button" className={styles.secondary} onClick={() => setSelected([])} disabled={!selected.length || busy}>Clear</button>
      <button type="button" className={styles.push} onClick={() => void pushSelected()} disabled={!selected.length || busy}><Send size={14}/>{busy ? "Pushing…" : `Push selected (${selected.length})`}</button>
    </div>

    {error ? <div className={styles.error}>{error}</div> : null}
    {message ? <div className={styles.success}>{message}</div> : null}

    <div className={styles.tableWrap}>
      <table>
        <thead><tr><th></th><th>Company</th><th>Market</th><th>Tier</th><th>People</th><th>Enriched</th><th>Phone-ready</th></tr></thead>
        <tbody>
          {ready.slice(0, 200).map((account) => <tr key={account.domain}>
            <td><input type="checkbox" checked={selected.includes(account.domain)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, account.domain] : current.filter((item) => item !== account.domain))}/></td>
            <td><strong>{account.name}</strong><small>{account.domain}</small></td>
            <td>{account.country || "Unknown"}</td>
            <td>{account.gtmTier} · {account.gtmScore}</td>
            <td>{account.peopleCount}</td>
            <td>{account.enrichedCount}</td>
            <td>{account.phoneReadyCount}</td>
          </tr>)}
          {!ready.length ? <tr><td colSpan={7} className={styles.empty}>No already-enriched zero-credit contacts are stored yet. Pending accounts remain saved and untouched.</td></tr> : null}
        </tbody>
      </table>
    </div>
  </section>;
}
