"use client";

import { SDR_OWNERS, type SdrDashboardProps } from "@/lib/sdr-owners";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  BadgeCheck,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  ListTodo,
  LockKeyhole,
  LoaderCircle,
  PhoneCall,
  Radar,
  Target,
  UserPlus,
  FileUp,
  Wrench,
} from "lucide-react";
import { Dashboard as ExistingDashboard } from "./Dashboard";
import { ToolAccessGate } from "./ToolAccessGate";
import { WorkspaceErrorBoundary } from "./WorkspaceErrorBoundary";
import styles from "@/components/DashboardShell.module.css";

type ShellView = "core" | "motion" | "maqsam" | "marita-priority" | "team-activity" | "net-new" | "inventory" | "gtm-brain" | "sales-handoff";

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
const LeadInventory = dynamic(
  () => import("@/components/NetNewAccounts").then((module) => module.NetNewAccounts),
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
  if (view === "inventory") return "inventory";
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
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [adminPrompt, setAdminPrompt] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  useEffect(() => {
    const syncFromUrl = () => setView(viewFromSearch(window.location.search));
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    let active = true;
    const check = () => { void fetch("/api/sdr-admin", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { unlocked?: boolean }) => {
        if (!active) return;
        setAdminUnlocked(Boolean(data.unlocked));
        setAdminChecked(true);
      })
      .catch(() => { if (active) { setAdminUnlocked(false); setAdminChecked(true); } }); };
    check();
    window.addEventListener("sdr:admin-auth-changed", check);
    return () => { active = false; window.removeEventListener("sdr:admin-auth-changed", check); };
  }, []);

  useEffect(() => {
    if (!adminChecked || adminUnlocked) return;
    const adminViews: ShellView[] = ["marita-priority"];
    if (!adminViews.includes(view)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState({}, "", url);
    setView("core");
    setAdminPrompt(true);
  }, [adminChecked, adminUnlocked, view]);

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
      setAdminPassword("");
      window.dispatchEvent(new CustomEvent("sdr:admin-auth-changed"));
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Unable to unlock admin tools.");
    } finally {
      setAdminBusy(false);
    }
  }

  function changeView(next: ShellView) {
    const adminViews: ShellView[] = ["marita-priority"];
    if (adminViews.includes(next) && !adminUnlocked) {
      setView("core");
      setAdminPrompt(true);
      return;
    }
    const url = new URL(window.location.href);
    if (next === "core") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState({}, "", url);
    setView(next);
    trackFeature(next === "core" ? "dashboard" : next);
  }

  const owner = SDR_OWNERS[sdr];
  const adminToolLabels = [
    ["Sales Nav Source", "Chrome companion · net-new people"],
    ["Sales Nav Full Run", "Live capture pipeline · resumable full search"],
    ["SignalHire Source", "List → HubSpot precheck → controlled enrich"],
    ["SignalHire CSV Queue", "CSV upload · dry-run · HubSpot push"],
    ["Call Queue Ops", "Marita Extensive-Lighter scheduling"],
    ["Company Repair", "Evidence-backed HubSpot property fixes"],
  ] as const;

  // Render inside both sidebar layouts; navigation must never depend on a popup.
  const sidebarTools = <section className={styles.sidebarTools} aria-label="SDR Tools">
    <div className={styles.toolsTitle}>SDR TOOLS · {adminUnlocked ? "UNLOCKED" : "PASSWORD PROTECTED"}</div>
    <nav className={styles.toolList} aria-label="SDR tools navigation">
            <button className={`${styles.toolItem} ${view === "gtm-brain" ? styles.activeTool : ""}`} type="button" aria-current={view === "gtm-brain" ? "page" : undefined} onClick={() => changeView("gtm-brain")}>
              <span className={`${styles.toolIcon} ${styles.brainIcon}`}><BrainCircuit size={17}/></span>
              <span className={styles.toolCopy}><strong>Talentera Intelligence</strong><small>Account priority · target pool · call strategy</small></span>
            </button>
            <button className={`${styles.toolItem} ${view === "sales-handoff" ? styles.activeTool : ""}`} type="button" aria-current={view === "sales-handoff" ? "page" : undefined} onClick={() => changeView("sales-handoff")}>
              <span className={`${styles.toolIcon} ${styles.gtmIcon}`}><BriefcaseBusiness size={17}/></span>
              <span className={styles.toolCopy}><strong>Sales Handoff</strong><small>Booking SDR → RM · follow-up · opportunities</small></span>
            </button>
            <button className={`${styles.toolItem} ${view === "inventory" ? styles.activeTool : ""}`} type="button" aria-current={view === "inventory" ? "page" : undefined} onClick={() => changeView("inventory")}>
              <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Building2 size={17}/></span>
              <span className={styles.toolCopy}><strong>Lead Inventory</strong><small>Company stock · sources · qualification · Marita & Daniel</small></span>
            </button>
            <button className={`${styles.toolItem} ${view === "net-new" ? styles.activeTool : ""}`} type="button" aria-current={view === "net-new" ? "page" : undefined} onClick={() => changeView("net-new")}>
              <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Target size={17}/></span>
              <span className={styles.toolCopy}><strong>Prospecting</strong><small>Persistent market coverage · Apollo universe · HubSpot dedupe</small></span>
            </button>
            <button className={`${styles.toolItem} ${view === "maqsam" ? styles.activeTool : ""}`} type="button" aria-current={view === "maqsam" ? "page" : undefined} onClick={() => changeView("maqsam")}>
              <span className={`${styles.toolIcon} ${styles.callsIcon}`}><PhoneCall size={17}/></span>
              <span className={styles.toolCopy}><strong>Calls</strong><small>Maqsam call intelligence · transcripts · sync</small></span>
            </button>
            <button className={`${styles.toolItem} ${view === "team-activity" ? styles.activeTool : ""}`} type="button" aria-current={view === "team-activity" ? "page" : undefined} onClick={() => changeView("team-activity")}>
              <span className={`${styles.toolIcon} ${styles.gtmIcon}`}><Activity size={17}/></span>
              <span className={styles.toolCopy}><strong>Team Activity {!adminUnlocked ? <LockKeyhole size={12}/> : null}</strong><small>Usage · adoption · workspace health</small></span>
            </button>

            <div className={styles.adminHeading}>
                <Wrench size={14}/><strong>Admin Tools</strong>
                <small>{adminUnlocked ? "Unlocked" : "Password protected"}</small>
              </div>

            {adminPrompt && !adminUnlocked ? <form className={styles.adminGate} onSubmit={(event) => void unlockAdmin(event)}>
              <strong>Admin password</strong>
              <small>Enter it once to unlock administrative SDR tools. No Owner key is needed.</small>
              <input autoFocus type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Admin password" autoComplete="one-time-code"/>
              {adminError ? <span className={styles.adminError}>{adminError}</span> : null}
              <button type="submit" disabled={adminBusy || !adminPassword.trim()}>{adminBusy ? "Unlocking…" : "Unlock admin tools"}</button>
            </form> : null}

            {adminUnlocked ? <div className={styles.advancedList}>
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
              <Link className={styles.toolItem} href="/signalhire-companion" onClick={() => trackFeature("signalhire-csv")}>
                <span className={`${styles.toolIcon} ${styles.salesIcon}`}><FileUp size={17}/></span>
                <span className={styles.toolCopy}><strong>SignalHire CSV Queue</strong><small>CSV upload · dry-run · HubSpot push</small></span>
              </Link>
              <button className={`${styles.toolItem} ${view === "marita-priority" ? styles.activeTool : ""}`} type="button" aria-current={view === "marita-priority" ? "page" : undefined} onClick={() => changeView("marita-priority")}>
                <span className={`${styles.toolIcon} ${styles.priorityIcon}`}><ListTodo size={17}/></span>
                <span className={styles.toolCopy}><strong>Call Queue Ops</strong><small>Marita Extensive-Lighter scheduling</small></span>
              </button>
              <Link className={styles.toolItem} href="/company-enrichment" onClick={() => trackFeature("company-repair")}>
                <span className={`${styles.toolIcon} ${styles.companyIcon}`}><Building2 size={17}/></span>
                <span className={styles.toolCopy}><strong>Company Repair</strong><small>Evidence-backed HubSpot property fixes</small></span>
              </Link>
            </div> : null}

            {!adminUnlocked ? <div className={styles.advancedList}>
              {adminToolLabels.map(([label, description]) => <button className={`${styles.toolItem} ${styles.lockedTool}`} type="button" key={label} onClick={() => setAdminPrompt(true)}>
                <span className={`${styles.toolIcon} ${styles.salesIcon}`}><LockKeyhole size={16}/></span>
                <span className={styles.toolCopy}><strong>{label}</strong><small>{description}</small></span>
              </button>)}
            </div> : null}
          </nav>
    </section>;

  if (view === "core") return <div className={styles.shell}>
    <ExistingDashboard
      sdr={sdr}
      active={active}
      initialSearch={initialSearch}
      workspaceNavigation={workspaceNavigation}
      onOpenMotion={() => changeView("motion")}
      onOpenMaqsam={() => changeView("maqsam")}
      sidebarTools={sidebarTools}
    />
  </div>;

  let toolContent: ReactNode;
  switch (view) {
    case "motion": toolContent = <MotionDashboard sdr={sdr} onBack={() => changeView("core")}/>; break;
    case "maqsam": toolContent = <MaqsamCallsDashboard initialAgent={sdr === "daniel" ? "daniel" : "marita"} onBack={() => changeView("core")}/>; break;
    case "marita-priority": toolContent = <MaritaPriorityQueue onBack={() => changeView("core")}/>; break;
    case "team-activity": toolContent = <TeamActivity onBack={() => changeView("core")}/>; break;
    case "inventory": toolContent = <LeadInventory inventory onBack={() => changeView("core")}/>; break;
    case "net-new": toolContent = <ProspectingCoverage onBack={() => changeView("core")}/>; break;
    case "gtm-brain": toolContent = <TalenteraIntelligenceWorkspace onBack={() => changeView("core")}/>; break;
    case "sales-handoff": toolContent = <SalesHandoffDashboard initialSearch={initialSearch} initialSdr={sdr === "daniel" ? "daniel" : "marita"} onBack={() => changeView("core")}/>; break;
  }

  return <div className={styles.shell}>
    <div className={styles.toolFrame}>
      <div className="workspace">
        <aside className="sidebar">
          <div className="brand">
            {sdr === "daniel" ? <><span className="evalufy-brand-mark"><Image src="/evalufy-transparent.png" sizes="176px" alt="Evalufy" width={2048} height={688} className="evalufy-logo" priority/><Image src="/evalufy-transparent.png" sizes="176px" alt="" aria-hidden="true" width={2048} height={688} className="evalufy-logo evalufy-symbol" priority/></span><span className="brand-subtitle">SDR Intelligence</span></> : <><div className="brand-logo" role="img" aria-label="Talentera ATS"/><span className="brand-subtitle">SDR Intelligence</span></>}
          </div>
          <div className="nav-label">MAIN</div>
          <nav><button type="button" onClick={() => changeView("core")}><BadgeCheck size={18}/><span>Analytics Dashboard</span></button></nav>
          <div className="nav-label">ANALYSIS</div>
          <nav><button className={view === "motion" ? "active" : ""} type="button" onClick={() => changeView("motion")}><Activity size={18}/><span>Inbound vs Outbound</span></button><button className={view === "maqsam" ? "active" : ""} aria-current={view === "maqsam" ? "page" : undefined} type="button" onClick={() => changeView("maqsam")}><PhoneCall size={18}/><span>Maqsam Calls</span></button></nav>
          {workspaceNavigation}
          <div className="nav-label owner-label">SDR OWNER</div>
          <div className="owner-card"><div className="avatar">{owner.initials}</div><div><span>Reporting for</span><strong>{owner.name}</strong></div><BadgeCheck size={17}/></div>
          {sidebarTools}
        </aside>
        <div className={`content ${styles.toolContent}`}>
          <WorkspaceErrorBoundary key={view} onBack={() => changeView("core")}>
            <ToolAccessGate>{toolContent}</ToolAccessGate>
          </WorkspaceErrorBoundary>
        </div>
      </div>
    </div>
  </div>;
}
