"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./SalesNavCompanionSetup.module.css";

type Status = {
  ok: boolean;
  paired: boolean;
  unlocked: boolean;
  signalHireConfigured: boolean;
  lastUsedAt?: string;
  latestFullRun?: { pagesRead: number; total: number; complete: boolean } | null;
};

async function readStatus() {
  const response = await fetch("/api/prospecting/salesnav/companion", { cache: "no-store" });
  return response.json() as Promise<Status>;
}

export function SalesNavCompanionSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setupKey, setSetupKey] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setStatus(await readStatus());
  }

  useEffect(() => {
    let active = true;
    void readStatus().then((payload) => { if (active) setStatus(payload); });
    return () => { active = false; };
  }, []);

  async function unlock() {
    if (!setupKey.trim()) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/prospecting/salesnav/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", setupKey: setupKey.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not unlock setup.");
      setSetupKey("");
      setMessage("Admin setup unlocked on this browser.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not unlock setup.");
    } finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true); setMessage(""); setToken("");
    try {
      const response = await fetch("/api/prospecting/salesnav/companion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_token" }),
      });
      const payload = await response.json() as { token?: string; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error || "Could not generate token.");
      setToken(payload.token);
      setMessage("New one-time pairing token generated. Copy it into the Chrome Companion now.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate token.");
    } finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <section className={styles.card}>
      <div className={styles.eyebrow}>TALENTERA SDR · CHROME COMPANION</div>
      <h1>Companion setup only</h1>
      <p>This page is only for pairing. Prospecting results no longer process here; every Sales Navigator capture goes to the Persistent Prospecting Queue.</p>
      <div className={styles.statusRow}>
        <span data-ok={status?.paired || false}>{status?.paired ? "Pairing active" : "Not paired"}</span>
        <span data-ok={Boolean(status?.lastUsedAt)}>{status?.lastUsedAt ? `Last contact ${new Date(status.lastUsedAt).toLocaleTimeString()}` : "No Companion contact yet"}</span>
      </div>

      {!status?.unlocked ? <div className={styles.block}>
        <label>Admin setup key</label>
        <div className={styles.row}>
          <input type="password" value={setupKey} onChange={(event) => setSetupKey(event.target.value)} placeholder="Enter SDR admin setup key" />
          <button disabled={busy || !setupKey.trim()} onClick={() => void unlock()}>Unlock</button>
        </div>
      </div> : <div className={styles.block}>
        <label>One-time pairing token</label>
        <div className={styles.row}>
          <input readOnly value={token} placeholder="Generate a token, then paste it into the extension" />
          <button disabled={busy} onClick={() => void generate()}>Generate / rotate token</button>
          <button disabled={!token} onClick={() => void navigator.clipboard.writeText(token)}>Copy token</button>
        </div>
      </div>}

      {message && <div className={styles.message}>{message}</div>}
      <div className={styles.actions}>
        <Link href="/signalhire-queue">Open Persistent Prospecting Queue</Link>
        <a href="https://github.com/amohamed-alt/SDR-Project/tree/main/chrome-companion" target="_blank" rel="noreferrer">Chrome Companion files</a>
      </div>
      <p className={styles.note}>Recommended flow: Sales Navigator → Companion “Capture FULL search” → Persistent Queue → HubSpot Check → manual SignalHire reveal only when needed → Push Ready + Tasks.</p>
    </section>
  </main>;
}
