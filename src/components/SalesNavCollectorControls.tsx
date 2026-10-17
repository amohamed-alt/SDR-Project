"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./SalesNavPipeline.module.css";

type CollectorState = {
  ok: boolean; version?: string; permission?: boolean; error?: string;
  tabs?: Array<{ id: number; title: string }>;
  capture?: { running: boolean; paused?: boolean; pages: number; total: number; error: string; message: string } | null;
  queue?: { runId: string; running: boolean; paused: boolean; done: number; total: number; updatedAt?: string; current?: { name: string; phase: string }; failed: Array<{ name: string; error: string }> } | null;
};
export function SalesNavCollectorControls({ runId, missing, captureLocked, readLocked }: { runId: string; missing: number; captureLocked?: boolean; readLocked?: boolean }) {
  const [state, setState] = useState<CollectorState | null>(null);
  const [tabId, setTabId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentRun = useRef(runId);
  useEffect(() => { currentRun.current = runId; }, [runId]);
  const lastProgress = useRef("");
  const pending = useRef(new Map<string, { resolve: (value: CollectorState) => void; timer: ReturnType<typeof setTimeout> }>());
  function request(action: string) {
    return new Promise<CollectorState>(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.current.delete(id); resolve({ ok: false, error: "Collector 1.8.0 is not connected to this tab. Update/reload the extension, then refresh this dashboard." }); }, action === "status" ? 2500 : 60000);
      pending.current.set(id, { resolve, timer });
      window.postMessage({ channel: "talentera-collector-request", id, action, runId, tabId: Number(tabId) }, window.location.origin);
    });
  }
  useEffect(() => {
    const callbacks = pending.current;
    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.channel !== "talentera-collector-response") return;
      const found = callbacks.get(event.data.id); if (!found) return;
      clearTimeout(found.timer); callbacks.delete(event.data.id); found.resolve(event.data.result || { ok: false, error: "Collector did not respond." });
    };
    window.addEventListener("message", listener);
    let active = true, checking = false;
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try {
        const next = await request("status");
        if (active) {
          setState(next);
          const progress = next.queue ? `${next.queue.runId}:${next.queue.done}:${next.queue.updatedAt || ""}` : "";
          if (progress && progress !== lastProgress.current && next.queue?.runId === currentRun.current) {
            window.dispatchEvent(new CustomEvent("salesnav:profiles-synced", { detail: { runId: next.queue.runId } }));
          }
          lastProgress.current = progress;
        }
      } finally { checking = false; }
    };
    void refresh(); const interval = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(interval); window.removeEventListener("message", listener); for (const value of callbacks.values()) { clearTimeout(value.timer); value.resolve({ ok: false }); } callbacks.clear(); };
  // Status polling deliberately carries no action/run payload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const searches = state?.tabs || [];
  const selectedTab = searches.some(tab => String(tab.id) === tabId) ? tabId : searches[0] ? String(searches[0].id) : "";
  const reading = Boolean(state?.queue?.running), capturing = Boolean(state?.capture?.running);
  const errors = state?.queue?.runId === runId ? state.queue.failed || [] : [];
  async function act(action: string) {
    setBusy(true); setError("");
    try {
      // Supply the visible default selection, not a stale empty React state.
      const id = crypto.randomUUID();
      const result = await new Promise<CollectorState>(resolve => {
        const timer = setTimeout(() => { pending.current.delete(id); resolve({ ok: false, error: "Collector timed out. Check its status before retrying." }); },60000);
        pending.current.set(id,{resolve,timer});
        window.postMessage({ channel: "talentera-collector-request", id, action, runId, tabId: Number(selectedTab) },window.location.origin);
      });
      if (!result.ok) throw new Error(result.error || "Collector operation failed.");
      setState(result);
      window.dispatchEvent(new CustomEvent("salesnav:profiles-synced"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Collector failed."); }
    finally { setBusy(false); }
  }
  return <section className={styles.collector} aria-label="Dashboard collector">
    <div><strong>Extension: 25 / 50 / Full → Dashboard: Check → Reveal → Push</strong><p>Start the capture from the extension. It reads and saves profile URLs first, then opens the ready batch here automatically.</p></div>
    <div role="status">{state?.ok ? `Collector ${state.version} connected${state.permission ? "" : " · Sales Nav permission required"}` : state?.error || "Connecting to Chrome collector…"}</div>
    {!state?.ok && <Link href="/salesnav-prospecting">Download / set up Collector 1.8.0</Link>}
    {state?.ok && state.version !== "1.8.0" && <p><Link href="/salesnav-prospecting">Update Collector to 1.8.0</Link> to restore the 25 / 50 / Full extension workflow and automatic URL handoff.</p>}
    {state?.ok && !state.permission && <p>Open the extension once and click Enable Sales Nav reading, then return here.</p>}
    <div className={styles.collectorActions}><label>Sales Nav search<select aria-label="Sales Nav search tab" value={selectedTab} onChange={event => setTabId(event.target.value)} disabled={busy || capturing}>{searches.length ? searches.map((tab,index) => <option key={tab.id} value={tab.id}>{tab.title}{index === 0 ? " · most recently used" : ` · search ${index + 1}`}</option>) : <option value="">Open a Sales Navigator People Search tab</option>}</select></label>
      {(state?.capture?.error || state?.capture?.paused) && <button onClick={() => void act("capture")} disabled={busy || captureLocked || !state?.ok || !state.permission || !selectedTab || capturing || reading}>Resume interrupted scrape</button>}
      <button onClick={() => void act("read")} disabled={busy || readLocked || !state?.ok || !state.permission || !runId || !missing || reading || capturing}>Read / retry {missing} missing URLs</button>
      <button onClick={() => void act("stop")} disabled={busy || !state?.ok || (!reading && !capturing)}>Stop collector</button>
    </div>
    {state?.capture && <small>Capture: {state.capture.pages} pages · {state.capture.total} cards · {state.capture.error || state.capture.message}</small>}
    {state?.queue && <small>URL reading: {state.queue.done}/{state.queue.total} attempted · {state.queue.running ? "running" : state.queue.paused ? "paused" : "finished"} · {state.queue.failed.length} failed{state.queue.runId !== runId ? " · another saved run" : ""}. CRM checks run separately below.</small>}
    {state?.queue?.current && <small>Current profile: {state.queue.current.name} · {state.queue.current.phase}</small>}
    {(error || state?.capture?.error) && <p role="alert">{error || state?.capture?.error}</p>}
    {errors.length > 0 && <details><summary>{errors.length} profile read errors · retry missing URLs above</summary><ul>{errors.slice(0,10).map((item,index) => <li key={index}><strong>{item.name}:</strong> {item.error}</li>)}</ul></details>}
  </section>;
}
