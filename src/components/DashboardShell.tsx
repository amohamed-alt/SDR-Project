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
  ListTodo,
  LoaderCircle,
  MailCheck,
  Menu,
  PhoneCall,
  Radar,
  Target,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import { Dashboard as ExistingDashboard } from "@/components/DashboardMotion";
import styles from "@/components/DashboardShell.module.css";

type ShellView = "core" | "maqsam" | "marita-priority" | "smartlead" | "team-activity" | "net-new" | "gtm-brain";

function ViewLoading() {
  return <main className={styles.viewLoading}><LoaderCircle size={24}/><strong>Loading workspace…</strong></main>;
}

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
  if (view === "maqsam") return "maqsam";
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
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [adminPrompt, setAdminPrompt] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncFromUrl = () => setView(viewFromUrl());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/sdr-admin", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { unlocked?: boolean }) => {
        if (!active) return;
        setAdminUnlocked(Boolean(data.unlocked));
        setAdminChecked(true);
      })
      .catch(() => { if (active) setAdminChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!adminChecked || adminUnlocked) return;
    const adminViews: ShellView[] = ["marita-priority", "team-activity"];
    if (!adminViews.includes(view)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState({}, "", url);
    setView("core");
    setToolsOpen(true);
    setAdminPrompt(true);
  }, [adminChecked, adminUnlocked, view]);

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

  async function unlockAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminBusy(true);
    setAdminError("");
    try {
      const response = await fetch("/api/sdr-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      const data = await response.json() as { unlocked?: boolean; error?: string };
      if (!response.ok || !data.unlocked) throw new Error(data.error || "Incorrect admin password.");
      setAdminUnlocked(true);
      setAdminChecked(true);
      setAdminPrompt(false);
      setAdvancedOpen(true);
      setAdminPassword("");
      window.dispatchEvent(new CustomEvent("sdr:admin-auth-changed"));
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Unable to unlock admin tools.");
    } finally {
      setAdminBusy(false);
    }
  }

  function toggleAdvanced() {
    if (advancedOpen) { setAdvancedOpen(false); return; }
    if (adminUnlocked) { setAdvancedOpen(true); setAdminPrompt(false); return; }
    setAdminPrompt(true);
    setAdvancedOpen(false);
  }

  function changeView(next: ShellView) {
    const adminViews: ShellView[] = ["marita-priority", "team-activity"];
    if (adminViews.includes(next) && !adminUnlocked) {
      setView("core");
      setToolsOpen(true);
      setAdminPrompt(true);
      return;
    }
    const url = new URL(window.location.href);
    if (next === "core") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState({}, "", url);
    setToolsOpen(false);
    setView(next);
    trackFeature(next === "core" ? "dashboard" : next);
  }

  if (view === "maqsam") return <MaqsamCallsDashboard onBack={() => changeView("core")}/>;
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

            <button className={styles.advancedToggle} type="button" onClick={toggleAdvanced} aria-expanded={advancedOpen}>
              <span><Wrench size={14}/><strong>Advanced & Data Ops</strong><small>{adminUnlocked ? "Admin unlocked · sources and controlled ops" : "Password protected admin tools"}</small></span>
              {advancedOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} 
            </button>

            {adminPrompt && !adminUnlocked ? <form className={styles.adminGate} onSubmit={(event) => void unlockAdmin(event)}>
              <strong>Admin password</strong>
              <small>Enter it once to unlock administrative SDR tools. No Owner key is needed.</small>
              <input autoFocus type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Admin password" autoComplete="current-password"/>
              {adminError ? <span className={styles.adminError}>{adminError}</span> : null}
              <button type="submit" disabled={adminBusy || !adminPassword.trim()}>{adminBusy ? "Unlocking…" : "Unlock admin tools"}</button>
            </form> : null}

            {advancedOpen && adminUnlocked ? <div className={styles.advancedList}>
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
        {toolsOpen ? <X size={18}/> : <Menu size={18}/>}<span>{toolsOpen ? "Close" : "SDR Tools"}</span><small>4</small>
      </button>
    </div>
  </div>;
}
