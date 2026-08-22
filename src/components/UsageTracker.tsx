"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Activity, ArrowRight, ShieldCheck } from "lucide-react";
import styles from "@/components/UsageTracker.module.css";

const VISITOR_ID_KEY = "sdr_v2_visitor_id";
const VISITOR_NAME_KEY = "sdr_v2_visitor_name";
const SESSION_ID_KEY = "sdr_v2_session_id";

function randomId(prefix: string) {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${raw}`;
}

function featureFromPath(pathname: string) {
  if (pathname === "/") return "dashboard";
  if (pathname.includes("account-intelligence")) return "gtm-brain";
  if (pathname.includes("company-enrichment")) return "company-repair";
  if (pathname.includes("salesnav-prospecting")) return "sales-nav";
  if (pathname.includes("marita-calls")) return "marita-calls";
  return pathname.replace(/^\//, "").replace(/\//g, "-") || "dashboard";
}

function featureFromLocation() {
  const pathname = window.location.pathname;
  if (pathname === "/") {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view) return view;
  }
  return featureFromPath(pathname);
}

type UsageDetail = {
  eventType?: string;
  feature?: string;
  path?: string;
  meta?: Record<string, unknown>;
};

export function UsageTracker() {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("");
  const [draftName, setDraftName] = useState("");
  const [ready, setReady] = useState(false);
  const identityRef = useRef<{ visitorId: string; sessionId: string; displayName: string } | null>(null);
  const startedRef = useRef(false);

  const currentFeature = useMemo(() => featureFromPath(pathname || "/"), [pathname]);

  const send = useCallback(async (detail: UsageDetail) => {
    const identity = identityRef.current;
    if (!identity) return;
    const payload = {
      visitorId: identity.visitorId,
      sessionId: identity.sessionId,
      displayName: identity.displayName,
      eventType: detail.eventType || "action",
      path: detail.path || window.location.pathname + window.location.search,
      feature: detail.feature || featureFromLocation(),
      meta: detail.meta || {},
    };
    try {
      await fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      // Tracking must never block or degrade the SDR workspace.
    }
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const storedName = (localStorage.getItem(VISITOR_NAME_KEY) || "").trim();
      let visitorId = localStorage.getItem(VISITOR_ID_KEY) || "";
      let sessionId = sessionStorage.getItem(SESSION_ID_KEY) || "";
      if (!visitorId) {
        visitorId = randomId("visitor");
        localStorage.setItem(VISITOR_ID_KEY, visitorId);
      }
      if (!sessionId) {
        sessionId = randomId("session");
        sessionStorage.setItem(SESSION_ID_KEY, sessionId);
      }
      if (storedName) {
        identityRef.current = { visitorId, sessionId, displayName: storedName };
        setDisplayName(storedName);
        setDraftName(storedName);
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

  useEffect(() => {
    if (!ready || !displayName || startedRef.current) return;
    startedRef.current = true;
    void send({ eventType: "session_start", feature: currentFeature });
  }, [currentFeature, displayName, ready, send]);

  useEffect(() => {
    if (!displayName || !startedRef.current) return;
    void send({ eventType: "page_view", feature: currentFeature, path: pathname || "/" });
  }, [currentFeature, displayName, pathname, send]);

  useEffect(() => {
    if (!displayName) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void send({ eventType: "heartbeat" });
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void send({ eventType: "heartbeat" });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [displayName, send]);

  useEffect(() => {
    const onUsage = (event: Event) => {
      const detail = (event as CustomEvent<UsageDetail>).detail || {};
      void send(detail);
    };
    window.addEventListener("sdr:usage", onUsage);
    return () => window.removeEventListener("sdr:usage", onUsage);
  }, [send]);

  useEffect(() => {
    const endSession = () => {
      const identity = identityRef.current;
      if (!identity) return;
      const payload = JSON.stringify({
        visitorId: identity.visitorId,
        sessionId: identity.sessionId,
        displayName: identity.displayName,
        eventType: "session_end",
        path: window.location.pathname + window.location.search,
        feature: featureFromLocation(),
        meta: {},
      });
      navigator.sendBeacon?.("/api/usage", new Blob([payload], { type: "application/json" }));
    };
    window.addEventListener("pagehide", endSession);
    return () => window.removeEventListener("pagehide", endSession);
  }, []);

  function saveIdentity(event: FormEvent) {
    event.preventDefault();
    const name = draftName.replace(/\s+/g, " ").trim().slice(0, 80);
    if (name.length < 2) return;
    const visitorId = localStorage.getItem(VISITOR_ID_KEY) || randomId("visitor");
    const sessionId = sessionStorage.getItem(SESSION_ID_KEY) || randomId("session");
    localStorage.setItem(VISITOR_ID_KEY, visitorId);
    localStorage.setItem(VISITOR_NAME_KEY, name);
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    identityRef.current = { visitorId, sessionId, displayName: name };
    setDisplayName(name);
  }

  if (!ready || displayName) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="usage-identity-title">
      <form className={styles.card} onSubmit={saveIdentity}>
        <div className={styles.mark}><Activity size={20}/></div>
        <div className={styles.eyebrow}>TALENTERA · SDR COMMAND CENTER</div>
        <h1 id="usage-identity-title">Who’s using the workspace?</h1>
        <p>Enter your name once. This keeps the dashboard open to everyone while showing who is active and which tools are actually being used.</p>
        <label>
          Your name
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            autoFocus
            autoComplete="name"
            maxLength={80}
            placeholder="e.g. Marita"
          />
        </label>
        <button type="submit" disabled={draftName.trim().length < 2}>
          Enter workspace <ArrowRight size={16}/>
        </button>
        <div className={styles.privacy}><ShieldCheck size={14}/> Usage events only — no passwords, messages, or keystrokes are recorded.</div>
      </form>
    </div>
  );
}
