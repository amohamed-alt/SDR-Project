"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type LatestFullRun = {
  id: string;
  pagesRead: number;
  total: number;
  complete: boolean;
  updatedAt?: string;
};

type CompanionStatus = {
  ok?: boolean;
  paired?: boolean;
  unlocked?: boolean;
  lastUsedAt?: string;
  latestFullRun?: LatestFullRun | null;
};

type SeenState = { id: string; complete: boolean };

function shortTime(value?: string) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

export function SalesNavLiveListener() {
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [error, setError] = useState("");
  const seen = useRef<SeenState | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const response = await fetch("/api/prospecting/salesnav/companion", { cache: "no-store" });
        const payload = await response.json() as CompanionStatus & { error?: string };
        if (!response.ok) throw new Error(payload.error || `Companion status HTTP ${response.status}`);
        if (!active) return;
        setStatus(payload);
        setError("");

        const latest = payload.latestFullRun || null;
        const next: SeenState = { id: latest?.id || "", complete: Boolean(latest?.complete) };
        if (seen.current === null) {
          seen.current = next;
          return;
        }

        const newRunArrived = Boolean(next.id && next.id !== seen.current.id);
        const currentRunFinished = Boolean(next.id && next.id === seen.current.id && next.complete && !seen.current.complete);
        seen.current = next;

        if ((newRunArrived || currentRunFinished) && !reloading.current) {
          const eventKey = `${next.id}:${next.complete ? "complete" : "started"}`;
          const previousEvent = window.sessionStorage.getItem("salesnav-live-listener-event");
          if (previousEvent !== eventKey) {
            window.sessionStorage.setItem("salesnav-live-listener-event", eventKey);
            reloading.current = true;
            window.location.reload();
          }
        }
      } catch (requestError) {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "Could not read Companion status.");
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const latest = status?.latestFullRun || null;
  const connected = Boolean(status?.paired);
  const serverText = latest
    ? `${latest.pagesRead || 0} page${latest.pagesRead === 1 ? "" : "s"} · ${latest.total || 0} leads · ${latest.complete ? "finished" : "capturing"}`
    : "waiting for first full-search page";

  return <aside style={{
    position: "fixed",
    right: 18,
    top: 18,
    zIndex: 9999,
    width: "min(390px, calc(100vw - 36px))",
    border: `1px solid ${error ? "#efc8c2" : connected ? "#bfe3d6" : "#ead9a8"}`,
    background: error ? "#fff4f2" : connected ? "#f0fbf7" : "#fff9e9",
    color: "#123f37",
    borderRadius: 14,
    boxShadow: "0 10px 30px rgba(8,47,42,.12)",
    padding: "11px 13px",
    fontSize: 12,
    lineHeight: 1.45,
  }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <strong style={{ fontSize: 12.5 }}>{error ? "Companion status error" : connected ? "● Companion live" : "● Companion not paired"}</strong>
      <Link href="/salesnav-prospecting" style={{ color: "#08795c", fontWeight: 800, textDecoration: "none" }}>Setup / token</Link>
    </div>
    <div style={{ marginTop: 4, color: error ? "#a23c34" : "#54736c" }}>{error || `Server: ${serverText}`}</div>
    <div style={{ marginTop: 2, color: "#6e8781" }}>Last Companion contact: {shortTime(status?.lastUsedAt)} · auto-refresh every 3s</div>
  </aside>;
}
