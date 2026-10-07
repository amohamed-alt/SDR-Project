"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import styles from "./ToolAccessGate.module.css";

export function ToolAccessGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch("/api/sdr-admin", { cache: "no-store", signal: controller.signal });
        const status = await response.json();
        if (!controller.signal.aborted) { setUnlocked(response.ok && Boolean(status.unlocked)); setChecked(true); }
      } catch { if (!controller.signal.aborted) { setUnlocked(false); setChecked(true); } }
    }
    void check();
    window.addEventListener("sdr:admin-auth-changed", check);
    window.addEventListener("focus", check);
    return () => { controller.abort(); window.removeEventListener("sdr:admin-auth-changed", check); window.removeEventListener("focus", check); };
  }, []);
  async function unlock(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/sdr-admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const status = await response.json();
      if (!response.ok || !status.unlocked) throw new Error(status.error || "Unable to unlock tools.");
      setPassword(""); setUnlocked(true); window.dispatchEvent(new Event("sdr:admin-auth-changed"));
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to unlock tools."); }
    finally { setBusy(false); }
  }
  async function lock() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/sdr-admin", { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to lock tools. Please retry.");
      setUnlocked(false); window.dispatchEvent(new Event("sdr:admin-auth-changed"));
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to lock tools."); }
    finally { setBusy(false); }
  }
  if (!checked) return <div className={styles.gate} role="status">Checking tool access…</div>;
  if (unlocked) return <><div className={styles.toolbar}><button onClick={() => void lock()} disabled={busy}><LockKeyhole size={14}/>Lock tools</button>{error ? <span role="alert">{error}</span> : null}</div>{children}</>;
  return <section className={styles.gate} aria-label="Locked SDR tools"><LockKeyhole size={28}/><h1>SDR tools are locked</h1><p>Enter your password to open Team Activity and the SDR tools.</p><form onSubmit={event => void unlock(event)}><label htmlFor="tools-password">Tools password</label><input id="tools-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/>{error ? <p role="alert">{error}</p> : null}<button disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock tools"}</button></form><Link href="/">Back to dashboard</Link></section>;
}
