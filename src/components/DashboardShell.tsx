"use client";

import { SDR_OWNERS, type SdrDashboardProps } from "@/lib/sdr-owners";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  BadgeCheck,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ChevronUp,
  ListTodo,
  LockKeyhole,
  LoaderCircle,
  PhoneCall,
  PhoneIncoming,
  Radar,
  Target,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import { Dashboard as ExistingDashboard } from "./Dashboard";
import styles from "@/components/DashboardShell.module.css";

type ShellView = "core" | "motion" | "maqsam" | "marita-priority" | "team-activity" | "net-new" | "gtm-brain" | "sales-handoff";

function ViewLoading() {
  return <main className={styles.viewLoading}><LoaderCircle size={24}/><strong>Loading workspace…</strong></main>;
}

const MotionDashboard = dynamic(
  () => import("@/components/DashboardMotion").then((module) => module.MotionDashboard),
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
const ProspectingCoverage = dynamic(
  () => import("@/components/ProspectingCoverage").then((module) => module.ProspectingCoverage),
  { ssr: false, loading: ViewLoading },
);
const TalenteraIntelligenceWorkspace = dynamic(
  () => import("@/components/TalenteraIntelligenceWorkspace").then((module) => module.TalenteraIntelligenceWorkspace),
  { ssr: false, loading: ViewLoading },
);
const SalesHandoffDashboard = dynamic(
  () => import("@/components/SalesHandoffDashboard").then((module) => module.SalesHandoffDashboard),
  { ssr: false, loading: ViewLoading },
);

function viewFromSearch(search: string): ShellView {
  const view = new URLSearchParams(search).get("view");
  if (view === "motion") return "motion";
  if (view === "maqsam") return "maqsam";
  if (view === "marita-priority") return "marita-priority";
  if (view === "team-activity") return "team-activity";
  if (view === "net-new") return "net-new";
  if (view === "gtm-brain") return "gtm-brain";
  if (view === "sales-handoff") return "sales-handoff";
  return "core";
}

function trackFeature(feature: string) {
  window.dispatchEvent(new CustomEvent("sdr:usage", {
    detail: { eventType: "feature_open", feature },
  }));
}

export function Dashboard({
  sdr = "marita",
  active = true,
  initialSearch = "",
  workspaceNavigation,
}: SdrDashboardProps & { initialSearch?: string; workspaceNavigation?: ReactNode }) {
  const [view, setView] = useState<ShellView>(() => viewFromSearch(initialSearch));
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
    const syncFromUrl = () => setView(viewFromSearch(window.location.search));
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
    const adminViews: ShellView[] = ["marita-priority"];
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
      const target = event.target;
      if (target instanceof Element && target.closest('[aria-controls="sdr-tools-menu"]')) return;
      if (toolsRef.current && !toolsRef.current.contains(target as Node)) setToolsOpen(false);
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
    setAdvancedOpen(true);
  }

  function changeView(next: ShellView) {
    const adminViews: ShellView[] = ["marita-priority"];
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

  const owner = SDR_OWNERS[sdr];
  const toolsCount = sdr === "marita" ? 10 : 9;
  const adminToolLabels = [
    ["Sales Nav Source", "Chrome companion · net-new people"],
    ["Sales Nav Full Run", "Live capture pipeline · resumable full search"],
    ["SignalHire Source", "List → HubSpot precheck → controlled enrich"],
    ["Call Queue Ops", "Marita Extensive-Lighter scheduling"],
    ["Company Repair", "Evidence-backed HubSpot property fixes"],
  ] as const;

  const toolsMenu = toolsOpen ? <div className={styles.toolsDock} ref={toolsRef}>
        <div className={styles.toolsMenu} id="sdr-tools-menu">
          <div className={styles.toolsHeader}>
            <div><span>SDR WORKSPACE</span><strong>Daily workflow</strong></div>
            <button type="button" onClick={() => setToolsOpen(false)} aria-label="Close tools menu"><X size={16}/></button>
          </div>

          <div className={styles.toolList}>
            <div className={styles.toolSectionLabel}>CORE WORK</div>
            <button className={styles.toolItem} type="button" onClick={() => changeView("gtm-brain")}>
              <span className={`${styles.toolIcon} ${styles.brainIcon}`}><BrainCircuit size={17}/></span>
              <span className={styles.toolCopy}><strong>Talentera Intelligence</strong><small>Account priority · target pool · call strategy</small></span>
            </button>
            {sdr === "marita" ? <button className={styles.toolItem} type="button" onClick={() => changeView("sales-handoff")}>
              <span className={`${styles.toolIcon} ${styles.gtmIcon}`}><BriefcaseBusiness size={17}/></span>
              <span className={styles.toolCopy}><strong>Sales Handoff</strong><small>Marita → Orsla 1 · follow-up · deals · pipeline risk</small></span>
            </button> : null}
            <button className={styles.toolItem} type="button" onClick={() => changeView("net-new")}>
              <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Target size={17}/></span>
              <span className={styles.toolCopy}><strong>Prospecting</strong><small>Persistent market coverage · Apollo universe · HubSpot dedupe</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("maqsam")}>
              <span className={`${styles.toolIcon} ${styles.callsIcon}`}><PhoneCall size={17}/></span>
              <span className={styles.toolCopy}><strong>Calls</strong><small>Maqsam call intelligence · transcripts · sync</small></span>
            </button>
            <button className={styles.toolItem} type="button" onClick={() => changeView("team-activity")}>
              <span className={`${styles.toolIcon} ${styles.gtmIcon}`}><Activity size={17}/></span>
              <span className={styles.toolCopy}><strong>Team Activity</strong><small>Usage · adoption · workspace health</small></span>
            </button>

            <button className={styles.advancedToggle} type="button" onClick={toggleAdvanced} aria-expanded={advancedOpen}>
              <span><Wrench size={14}/><strong>Admin Tools · 5</strong><small>{adminUnlocked ? "Admin unlocked · sources and controlled ops" : "Password protected · expand to preview"}</small></span>
              {advancedOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} 
            </button>

            {adminPrompt && !adminUnlocked ? <form className={styles.adminGate} onSubmit={(event) => void unlockAdmin(event)}>
              <strong>Admin password</strong>
              <small>Enter it once to unlock administrative SDR tools. No Owner key is needed.</small>
              <input autoFocus type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Admin password" autoComplete="one-time-code"/>
              {adminError ? <span className={styles.adminError}>{adminError}</span> : null}
              <button type="submit" disabled={adminBusy || !adminPassword.trim()}>{adminBusy ? "Unlocking…" : "Unlock admin tools"}</button>
            </form> : null}

            {advancedOpen && adminUnlocked ? <div className={styles.advancedList}>
              <Link className={styles.toolItem} href="/salesnav-prospecting" onClick={() => trackFeature("sales-nav")}>
                <span className={`${styles.toolIcon} ${styles.salesIcon}`}><Radar size={17}/></span>
                <span className={styles.toolCopy}><strong>Sales Nav Source</strong><small>Chrome companion · net-new people</small></span>
              </Link>
              <Link className={styles.toolItem} href="/salesnav-full-run" onClick={() => trackFeature("sales-nav-full-run")}>
                <span className={`${styles.toolIcon} ${styles.salesIcon}`}><Radar size={17}/></span>
                <span className={styles.toolCopy}><strong>Sales Nav Full Run</strong><small>Live capture pipeline · resumable full search</small></span>
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
            </div> : null}

            {advancedOpen && !adminUnlocked ? <div className={styles.advancedList}>
              {adminToolLabels.map(([label, description]) => <button className={`${styles.toolItem} ${styles.lockedTool}`} type="button" key={label} onClick={() => setAdminPrompt(true)}>
                <span className={`${styles.toolIcon} ${styles.salesIcon}`}><LockKeyhole size={16}/></span>
                <span className={styles.toolCopy}><strong>{label}</strong><small>{description}</small></span>
              </button>)}
            </div> : null}
          </div>
        </div>
    </div> : null;

  if (view === "core") return <div className={styles.shell}>
    <ExistingDashboard
      sdr={sdr}
      active={active}
      initialSearch={initialSearch}
      workspaceNavigation={workspaceNavigation}
      onOpenMotion={() => changeView("motion")}
      onToggleTools={() => setToolsOpen((current) => !current)}
      toolsOpen={toolsOpen}
      toolsCount={toolsCount}
    />
    {toolsMenu}
  </div>;

  let toolContent: ReactNode;
  switch (view) {
    case "motion": toolContent = <MotionDashboard sdr={sdr} onBack={() => changeView("core")}/>; break;
    case "maqsam": toolContent = <MaqsamCallsDashboard onBack={() => changeView("core")}/>; break;
    case "marita-priority": toolContent = <MaritaPriorityQueue onBack={() => changeView("core")}/>; break;
    case "team-activity": toolContent = <TeamActivity onBack={() => changeView("core")}/>; break;
    case "net-new": toolContent = <ProspectingCoverage onBack={() => changeView("core")}/>; break;
    case "gtm-brain": toolContent = <TalenteraIntelligenceWorkspace onBack={() => changeView("core")}/>; break;
    case "sales-handoff": toolContent = <SalesHandoffDashboard onBack={() => changeView("core")}/>; break;
  }

  return <div className={styles.shell}>
    <div className={styles.toolFrame}>
      <div className="workspace">
        <aside className="sidebar">
          <div className="brand">
            {sdr === "daniel" ? <><span className="evalufy-brand-mark"><Image src="/evalufy-logo.png" alt="Evalufy" width={1200} height={628} className="evalufy-logo" priority/></span><span className="brand-subtitle">SDR Intelligence</span></> : <><div className="brand-logo" role="img" aria-label="Talentera ATS"/><span className="brand-subtitle">SDR Intelligence</span></>}
          </div>
          <div className="nav-label">MAIN</div>
          <nav><button type="button" onClick={() => changeView("core")}><BadgeCheck size={18}/><span>Analytics Dashboard</span></button></nav>
          <div className="nav-label">ANALYSIS</div>
          <nav><button className={view === "motion" ? "active" : ""} type="button" onClick={() => changeView("motion")}><Activity size={18}/><span>Inbound vs Outbound</span></button></nav>
          <div className="nav-label">WORKSPACE</div>
          <nav><button type="button" onClick={() => setToolsOpen((current) => !current)} aria-expanded={toolsOpen} aria-controls="sdr-tools-menu"><PhoneIncoming size={18}/><span>SDR Tools</span><small className="sdr-tools-count">{toolsCount}</small></button></nav>
          {workspaceNavigation}
          <div className="nav-label owner-label">SDR OWNER</div>
          <div className="owner-card"><div className="avatar">{owner.initials}</div><div><span>Reporting for</span><strong>{owner.name}</strong></div><BadgeCheck size={17}/></div>
        </aside>
        <div className={`content ${styles.toolContent}`}>{toolContent}</div>
      </div>
    </div>
    {toolsMenu}
  </div>;
}
