"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Activity, BrainCircuit, Building2, Flame, ListTodo, LoaderCircle, Menu, PhoneCall, Radar, Search, Target, X } from "lucide-react";
import { Dashboard as ExistingDashboard } from "@/components/DashboardMotion";
import styles from "@/components/DashboardShell.module.css";

type ShellView = "core" | "maqsam" | "hiring" | "career" | "ats-intent" | "marita-priority" | "team-activity" | "net-new";

function ViewLoading() {
  return <main className={styles.viewLoading}><LoaderCircle size={24}/><strong>Loading workspace…</strong></main>;
}

const AtsIntentSearch = dynamic(
  () => import("@/components/AtsIntentSearch").then((module) => module.AtsIntentSearch),
  { ssr: false, loading: ViewLoading },
);
const CareerIntelligence = dynamic(
  () => import("@/components/CareerIntelligence").then((module) => module.CareerIntelligence),
  { ssr: false, loading: ViewLoading },
);
const HiringIntelligence = dynamic(
  () => import("@/components/HiringIntelligence").then((module) => module.HiringIntelligence),
  { ssr: false, loading: ViewLoading },
);
const MaqsamCallsDashboard = dynamic(
  () => import("@/components/MaqsamCallsDashboard").then((module) => module.MaqsamCallsDashboard),
  { ssr: false, loading: ViewLoading },
);
const MaritaPriorityQueue = dynamic(
  () => import("@/components/MaritaPriorityQueue").then((module) => module.MaritaPriorityQueue),
  { ssr: false, loading: ViewLoading },
);
const TeamActivity = dynamic(
  () => import("@/components/TeamActivity").then((module) => module.TeamActivity),
  { ssr: false, loading: ViewLoading },
);
const NetNewAccounts = dynamic(
  () => import("@/components/NetNewAccounts").then((module) => module.NetNewAccounts),
  { ssr: false, loading: ViewLoading },
);

function viewFromUrl(): ShellView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "maqsam") return "maqsam";
  if (view === "hiring") return "hiring";
  if (view === "career") return "career";
  if (view === "ats-intent") return "ats-intent";
  if (view === "marita-priority") return "marita-priority";
  if (view === "team-activity") return "team-activity";
  if (view === "net-new") return "net-new";
  return "core";
}

function trackFeature(feature: string) {
  window.dispatchEvent(new CustomEvent("sdr:usage", {
    detail: { eventType: "feature_open", feature },
  }));
}

export function Dashboard() {
  const [view, setView] = useState<ShellView>("core");
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncFromUrl = () => setView(viewFromUrl());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    if (!toolsOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) setToolsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolsOpen]);

  function changeView(next: ShellView) {
    const url = new URL(window.location.href);
    if (next === "core") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState({}, "", url);
    setToolsOpen(false);
    setView(next);
    trackFeature(next === "core" ? "dashboard" : next);
  }

  if (view === "maqsam") return <MaqsamCallsDashboard onBack={() => changeView("core")}/>;
  if (view === "hiring") return <HiringIntelligence onBack={() => changeView("core")}/>;
  if (view === "career") return <CareerIntelligence onBack={() => changeView("core")}/>;
  if (view === "ats-intent") return <AtsIntentSearch onBack={() => changeView("core")}/>;
  if (view === "marita-priority") return <MaritaPriorityQueue onBack={() => changeView("core")}/>;
  if (view === "team-activity") return <TeamActivity onBack={() => changeView("core")}/>;
  if (view === "net-new") return <NetNewAccounts onBack={() => changeView("core")}/>;

  return <div className={styles.shell}>
    <ExistingDashboard/>

    <div className={styles.toolsDock} ref={toolsRef}>
      {toolsOpen ? (
        <div className={styles.toolsMenu} id="sdr-tools-menu">
          <div className={styles.toolsHeader}>
            <div>
              <span>SDR WORKSPACE</span>
              <strong>Tools & Intelligence</strong>
            </div>
            <button type="button" onClick={() => setToolsOpen(false)} aria-label="Close tools menu"><X size={16}/></button>
          </div>

          <div className={styles.toolList}>
            <button className={styles.toolItem} type="button" onClick={() => changeView("net-new")}>
              <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Target size={17}/></span>
              <span className={styles.toolCopy}><strong>Net-New Accounts</strong><small>Apollo → Persona → SignalHire → HubSpot</small></span>
            </button>
            <Link className={styles.toolItem} href="/company-enrichment" onClick={() => trackFeature("company-repair")}>
              <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Building2 size={17}/></span>
              <span className={styles.toolCopy}><strong>Company Repair</strong><small>HubSpot enrichment & property fixes</small></span>
            </Link>
            <Link className={styles.toolItem} href="/account-intelligence" onClick={() => trackFeature("gtm-brain")}>
              <span className={`${styles.toolIcon} ${styles.brainIcon}`}><BrainCircuit size={17}/></span>
              <span className={styles.toolCopy}><strong>GTM Brain</strong><small>Account scoring & intelligence</small></span>
            </Link>
            <button className={styles.toolItem} type="button" onClick={() => changeView("team-activity")}>
              <span className={`${styles.toolIcon} ${styles.gtmIcon}`}><Activity size={17}/></span>
              <span className={styles.toolCopy}><strong>Team Activity</strong><small>Live users & workspace adoption</small></span>
            </button>
            <Link className={styles.toolItem} href="/salesnav-prospecting" onClick={() => trackFeature("sales-nav")}>
              <span className={`${styles.toolIcon} ${styles.salesIcon}`}><Radar size={17}/></span>
              <span className={styles.toolCopy}><strong>Sales Nav</strong><small>Net-new prospecting</small></span>
            </Link>
            <button className={styles.toolItem} type="button" onClick={() => changeView("career")}>
              <span className={`${styles.toolIcon} ${styles.careerIcon}`}><Search size={17}/></span>
              <span className={styles.toolCopy}><strong>Career Intelligence</strong><small>Career pages & ATS detection</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("marita-priority")}>
              <span className={`${styles.toolIcon} ${styles.priorityIcon}`}><ListTodo size={17}/></span>
              <span className={styles.toolCopy}><strong>Marita Priority</strong><small>Call-next queue</small></span>
            </button>
            <Link className={styles.toolItem} href="/marita-calls" onClick={() => trackFeature("marita-calls")}>
              <span className={`${styles.toolIcon} ${styles.callsIcon}`}><PhoneCall size={17}/></span>
              <span className={styles.toolCopy}><strong>Marita Calls</strong><small>Maqsam call activity</small></span>
            </Link>
            <button className={styles.toolItem} type="button" onClick={() => changeView("hiring")}>
              <span className={`${styles.toolIcon} ${styles.hiringIcon}`}><Flame size={17}/></span>
              <span className={styles.toolCopy}><strong>Hiring Signals</strong><small>KSA + UAE hiring activity</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("ats-intent")}>
              <span className={`${styles.toolIcon} ${styles.intentIcon}`}><Search size={17}/></span>
              <span className={styles.toolCopy}><strong>ATS Intent</strong><small>LinkedIn signals + SignalHire</small></span>
            </button>
          </div>
        </div>
      ) : null}

      <button
        className={`${styles.toolsToggle} ${toolsOpen ? styles.toolsToggleOpen : ""}`}
        type="button"
        onClick={() => setToolsOpen((current) => !current)}
        aria-expanded={toolsOpen}
        aria-controls="sdr-tools-menu"
      >
        {toolsOpen ? <X size={18}/> : <Menu size={18}/>}<span>{toolsOpen ? "Close" : "SDR Tools"}</span><small>10</small>
      </button>
    </div>
  </div>;
}
