"use client";

import { useEffect, useState } from "react";
import { Send, ShieldCheck } from "lucide-react";
import styles from "@/components/SmartleadDailySendBar.module.css";

const OWNER_STORAGE_KEY = "sdr-acquisition-owner-token";

type OrchestratorPayload = {
  dailyNewLeadTarget?: number;
  schedule?: { timezone?: string; businessDays?: string; sendWindow?: string; touch1?: string; touch2?: string; touch3?: string };
  state?: { status?: string; riyadhDate?: string; queued?: number; talentera?: number; evalufy?: number; message?: string };
};

type DailySendResult = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  blocked?: boolean;
  state?: { queued?: number; talentera?: number; evalufy?: number; message?: string };
  verification?: { millionVerifierChecks?: number; millionVerifierCacheHits?: number; signalHireLookups?: number; replacements?: number; validCurrent?: number; noValidEmail?: number };
  languagePreflight?: { checked?: number; staleIntelligenceReset?: boolean; issues?: number };
  error?: string;
  details?: unknown;
};

function savedOwnerToken() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(OWNER_STORAGE_KEY) || "";
}

export function SmartleadDailySendBar() {
  const [info, setInfo] = useState<OrchestratorPayload | null>(null);
  const [ownerToken, setOwnerToken] = useState(savedOwnerToken);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/smartlead/orchestrator-v3", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setInfo(payload as OrchestratorPayload | null))
      .catch(() => undefined);
  }, []);

  function saveToken(value: string) {
    setOwnerToken(value);
    if (value.trim()) window.sessionStorage.setItem(OWNER_STORAGE_KEY, value.trim());
    else window.sessionStorage.removeItem(OWNER_STORAGE_KEY);
  }

  async function sendToday() {
    const token = ownerToken.trim();
    if (!token) { setError("Enter the Owner key first."); return; }
    const target = info?.dailyNewLeadTarget || 50;
    if (!window.confirm(`Run the verified daily batch now? Up to ${target} fresh leads can be queued. MillionVerifier, SignalHire fallback, Sales safety, language routing and dedupe all run before Smartlead.`)) return;

    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/smartlead/send-today", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-acquisition-owner-token": token },
        body: JSON.stringify({ confirm: "SEND_VERIFIED_DAILY_BATCH" }),
      });
      const result = await response.json() as DailySendResult;
      if (!response.ok) throw new Error(result.error || "Daily send failed.");
      if (result.skipped) {
        setNotice(result.reason || "Today's batch was already processed; nothing was duplicated.");
      } else if (result.blocked) {
        setNotice(result.state?.message || "Safety gate blocked the batch; nothing was queued.");
      } else {
        const queued = result.state?.queued || 0;
        const talentera = result.state?.talentera || 0;
        const evalufy = result.state?.evalufy || 0;
        const mv = result.verification?.millionVerifierChecks || 0;
        const cache = result.verification?.millionVerifierCacheHits || 0;
        const signal = result.verification?.signalHireLookups || 0;
        const replaced = result.verification?.replacements || 0;
        setNotice(`Queued ${queued}: ${talentera} Talentera + ${evalufy} Evalufy. MillionVerifier ${mv} new checks + ${cache} cache hits; SignalHire ${signal} fallbacks; ${replaced} verified replacements.`);
      }
      const refreshed = await fetch("/api/smartlead/orchestrator-v3", { cache: "no-store" });
      if (refreshed.ok) setInfo(await refreshed.json() as OrchestratorPayload);
      window.dispatchEvent(new CustomEvent("smartlead:daily-send-complete"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Daily send failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.bar}>
    <div className={styles.copy}>
      <strong><ShieldCheck size={14}/> Verified daily send</strong>
      <span>One click uses the same safe engine as autopilot. Leads are routed English→English and Arabic→Arabic before Smartlead.</span>
      <div className={styles.meta}>
        <small>Target up to {info?.dailyNewLeadTarget || 50} new/day</small>
        <small>{info?.schedule?.businessDays || "Sunday-Thursday"}</small>
        <small>{info?.schedule?.sendWindow || "09:30-16:30"} Riyadh</small>
        <small>Touch 1 Day 0 · FU1 +3d · FU2 +4d</small>
        <small>Last: {info?.state?.status || "never"} · {info?.state?.queued || 0} queued</small>
      </div>
      {notice ? <span className={styles.notice}>{notice}</span> : null}
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
    <div className={styles.controls}>
      <input type="password" value={ownerToken} onChange={(event) => saveToken(event.target.value)} placeholder="Owner key" aria-label="Owner key"/>
      <button type="button" onClick={() => void sendToday()} disabled={busy}><Send size={14}/> {busy ? "Running checks…" : "Send today's batch"}</button>
    </div>
  </section>;
}
