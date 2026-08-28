"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BrainCircuit,
  Building2,
  ChevronDown,
  ChevronUp,
  Flame,
  ListTodo,
  LoaderCircle,
  MailCheck,
  Menu,
  PhoneCall,
  Radar,
  Search,
  Sparkles,
  Target,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import { Dashboard as ExistingDashboard } from "@/components/DashboardMotion";
import styles from "@/components/DashboardShell.module.css";

type ShellView = "core" | "ultimate" | "maqsam" | "hiring" | "career" | "ats-intent" | "marita-priority" | "smartlead" | "team-activity" | "net-new" | "gtm-brain";

function ViewLoading() {
  return <main className={styles.viewLoading}><LoaderCircle size={24}/><strong>Loading workspace…</strong></main>;
}

const UltimateDashboard = dynamic(
  () => import("@/components/UltimateDashboard").then((module) => module.UltimateDashboard),
  { ssr: false, loading: ViewLoading },
);
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
const SmartleadCommandCenter = dynamic(
  () => import("@/components/SmartleadCommandCenter").then((module) => module.SmartleadCommandCenter),
  { ssr: false, loading: ViewLoading },
);
const TeamActivity = dynamic(
  () => import("@/components/TeamActivity").then((module) => module.TeamActivity),
  { ssr: false, loading: ViewLoading },
);
const BestAccounts = dynamic(
  () => import("@/components/BestAccounts").then((module) => module.BestAccounts),
  { ssr: false, loading: ViewLoading },
);
const TalenteraIntelligenceWorkspace = dynamic(
  () => import("@/components/TalenteraIntelligenceWorkspace").then((module) => module.TalenteraIntelligenceWorkspace),
  { ssr: false, loading: ViewLoading },
);

function viewFromUrl(): ShellView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "ultimate") return "ultimate";
  if (view === "maqsam") return "maqsam";
  if (view === "hiring") return "hiring";
  if (view === "career") return "career";
  if (view === "ats-intent") return "ats-intent";
  if (view === "marita-priority") return "marita-priority";
  if (view === "smartlead") return "smartlead";
  if (view === "team-activity") return "team-activity";
  if (view === "net-new") return "net-new";
  if (view === "gtm-brain") return "gtm-brain";
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  if (view === "ultimate") return <UltimateDashboard onBack={() => changeView("core")}/>;
  if (view === "maqsam") return <MaqsamCallsDashboard onBack={() => changeView("core")}/>;
  if (view === "hiring") return <HiringIntelligence onBack={() => changeView("core")}/>;
  if (view === "career") return <CareerIntelligence onBack={() => changeView("core")}/>;
  if (view === "ats-intent") return <AtsIntentSearch onBack={() => changeView("core")}/>;
  if (view === "marita-priority") return <MaritaPriorityQueue onBack={() => changeView("core")}/>;
  if (view === "smartlead") return <SmartleadCommandCenter onBack={() => changeView("core")}/>;
  if (view === "team-activity") return <TeamActivity onBack={() => changeView("core")}/>;
  if (view === "net-new") return <BestAccounts onBack={() => changeView("core")}/>;
  if (view === "gtm-brain") return <TalenteraIntelligenceWorkspace onBack={() => changeView("core")}/>;

  return <div className={styles.shell}>
    <ExistingDashboard/>

    <div className={styles.toolsDock} ref={toolsRef}>
      {toolsOpen ? (
        <div className={styles.toolsMenu} id="sdr-tools-menu">
          <div className={styles.toolsHeader}>
            <div>
              <span>SDR WORKSPACE</span>
              <strong>Daily workflow</strong>
            </div>
            <button type="button" onClick={() => setToolsOpen(false)} aria-label="Close tools menu"><X size={16}/></button>
          </div>

          <div className={styles.toolList}>
            <div className={styles.toolSectionLabel}>CORE WORK</div>
            <button className={styles.toolItem} type="button" onClick={() => changeView("ultimate")}>
              <span className={`${styles.toolIcon} ${styles.ultimateIcon}`}><Sparkles size={17}/></span>
              <span className={styles.toolCopy}><strong>Ultimate Dashboard</strong><small>Motion · GSAP · ECharts · Three.js · premium UI</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("gtm-brain")}>
              <span className={`${styles.toolIcon} ${styles.brainIcon}`}><BrainCircuit size={17}/></span>
              <span className={styles.toolCopy}><strong>Talentera Intelligence</strong><small>Account priority · target pool · call strategy</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("net-new")}>
              <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Target size={17}/></span>
              <span className={styles.toolCopy}><strong>Prospecting</strong><small>Apollo discovery · ranked net-new accounts</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("smartlead")}>
              <span className={`${styles.toolIcon} ${styles.priorityIcon}`}><MailCheck size={17}/></span>
              <span className={styles.toolCopy}><strong>Outreach</strong><small>Verified Smartlead queue · live execution</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("maqsam")}>
              <span className={`${styles.toolIcon} ${styles.callsIcon}`}><PhoneCall size={17}/></span>
              <span className={styles.toolCopy}><strong>Calls</strong><small>Maqsam call intelligence · transcripts · sync</small></span>
            </button>

            <button className={styles.advancedToggle} type="button" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>
              <span><Wrench size={14}/><strong>Advanced & Data Ops</strong><small>Sources, verification and admin tools</small></span>
              {advancedOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} 
            </button>

            {advancedOpen ? <div className={styles.advancedList}>
              <Link className={styles.toolItem} href="/salesnav-prospecting" onClick={() => trackFeature("sales-nav")}>
                <span className={`${styles.toolIcon} ${styles.salesIcon}`}><Radar size={17}/></span>
                <span className={styles.toolCopy}><strong>Sales Nav Source</strong><small>Chrome companion · net-new people</small></span>
              </Link>
              <Link className={styles.toolItem} href="/signalhire-queue" onClick={() => trackFeature("signalhire-queue")}>
                <span className={`${styles.toolIcon} ${styles.salesIcon}`}><UserPlus size={17}/></span>
                <span className={styles.toolCopy}><strong>SignalHire Source</strong><small>List → HubSpot precheck → controlled enrich</small></span>
              </Link>
              <button className={styles.toolItem} type="button" onClick={() => changeView("marita-priority")}>
                <span className={`${styles.toolIcon} ${styles.priorityIcon}`}><ListTodo size={17}/></span>
                <span className={styles.toolCopy}><strong>Call Queue Ops</strong><small>Marita Extensive-Lighter scheduling</small></span>
              </button>
              <button className={styles.toolItem} type="button" onClick={() => changeView("hiring")}>
                <span className={`${styles.toolIcon} ${styles.hiringIcon}`}><Flame size={17}/></span>
                <span className={styles.toolCopy}><strong>Hiring Verification</strong><small>Verified current jobs · stale cleanup</small></span>
              </button>
              <button className={styles.toolItem} type="button" onClick={() => changeView("ats-intent")}>
                <span className={`${styles.toolIcon} ${styles.intentIcon}`}><Search size={17}/></span>
                <span className={styles.toolCopy}><strong>ATS Intent Signals</strong><small>Public buying / replacement signals</small></span>
              </button>
              <button className={styles.toolItem} type="button" onClick={() => changeView("career")}>
                <span className={`${styles.toolIcon} ${styles.careerIcon}`}><Search size={17}/></span>
                <span className={styles.toolCopy}><strong>Career & ATS Data</strong><small>Career discovery · ATS review · HubSpot sync</small></span>
              </button>
              <Link className={styles.toolItem} href="/company-enrichment" onClick={() => trackFeature("company-repair")}>
                <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Building2 size={17}/></span>
                <span className={styles.toolCopy}><strong>Company Repair</strong><small>Evidence-backed HubSpot property fixes</small></span>
              </Link>
              <button className={styles.toolItem} type="button" onClick={() => changeView("team-activity")}>
                <span className={`${styles.toolIcon} ${styles.gtmIcon}`}><Activity size={17}/></span>
                <span className={styles.toolCopy}><strong>Team Activity</strong><small>Usage · adoption · workspace health</small></span>
              </button>
            </div> : null}
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
        {toolsOpen ? <X size={18}/> : <Menu size={18}/>}<span>{toolsOpen ? "Close" : "SDR Tools"}</span><small>5</small>
      </button>
    </div>
  </div>;
}
