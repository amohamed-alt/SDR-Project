"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrainCircuit, Flame, ListTodo, LoaderCircle, PhoneCall, Radar, Search, Sparkles } from "lucide-react";
import { Dashboard as ExistingDashboard } from "@/components/DashboardMotion";
import styles from "@/components/DashboardShell.module.css";

type ShellView = "core" | "maqsam" | "hiring" | "career" | "ats-intent" | "marita-priority";

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

function viewFromUrl(): ShellView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "maqsam") return "maqsam";
  if (view === "hiring") return "hiring";
  if (view === "career") return "career";
  if (view === "ats-intent") return "ats-intent";
  if (view === "marita-priority") return "marita-priority";
  return "core";
}

export function Dashboard() {
  const [view, setView] = useState<ShellView>("core");

  useEffect(() => {
    const syncFromUrl = () => setView(viewFromUrl());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  function changeView(next: ShellView) {
    const url = new URL(window.location.href);
    if (next === "core") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState({}, "", url);
    setView(next);
  }

  if (view === "maqsam") return <MaqsamCallsDashboard onBack={() => changeView("core")}/>;
  if (view === "hiring") return <HiringIntelligence onBack={() => changeView("core")}/>;
  if (view === "career") return <CareerIntelligence onBack={() => changeView("core")}/>;
  if (view === "ats-intent") return <AtsIntentSearch onBack={() => changeView("core")}/>;
  if (view === "marita-priority") return <MaritaPriorityQueue onBack={() => changeView("core")}/>;

  return <div className={styles.shell}>
    <ExistingDashboard/>
    <Link className={styles.brainLauncher} href="/account-intelligence">
      <BrainCircuit size={17}/><span>GTM Brain</span><small>Account Intel</small>
    </Link>
    <Link className={styles.gtmLauncher} href="/gtm-research">
      <Sparkles size={17}/><span>GTM Research</span><small>AI Wizard</small>
    </Link>
    <Link className={styles.salesNavLauncher} href="/salesnav-prospecting">
      <Radar size={17}/><span>Sales Nav</span><small>Net New</small>
    </Link>
    <button className={styles.careerLauncher} type="button" onClick={() => changeView("career")}>
      <Search size={17}/><span>Career Intelligence</span><small>Career + ATS</small>
    </button>
    <button className={styles.priorityLauncher} type="button" onClick={() => changeView("marita-priority")}>
      <ListTodo size={17}/><span>Marita Priority</span><small>Call Next</small>
    </button>
    <button className={styles.hiringLauncher} type="button" onClick={() => changeView("hiring")}>
      <Flame size={17}/><span>Hiring Signals</span><small>KSA + UAE</small>
    </button>
    <Link className={styles.maqsamLauncher} href="/marita-calls">
      <PhoneCall size={17}/><span>Marita Calls</span><small>Maqsam</small>
    </Link>
    <button className={styles.intentLauncher} type="button" onClick={() => changeView("ats-intent")}>
      <Search size={17}/><span>ATS Intent</span><small>LinkedIn Posts</small>
    </button>
  </div>;
}
