"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Flame, PhoneCall, Search } from "lucide-react";
import { Dashboard as ExistingDashboard } from "@/components/DashboardMotion";
import { CareerIntelligence } from "@/components/CareerIntelligence";
import { HiringIntelligence } from "@/components/HiringIntelligence";
import { MaqsamCallsDashboard } from "@/components/MaqsamCallsDashboard";
import styles from "@/components/DashboardShell.module.css";

type ShellView = "core" | "maqsam" | "hiring" | "career";

function viewFromUrl(): ShellView {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "maqsam") return "maqsam";
  if (view === "hiring") return "hiring";
  if (view === "career") return "career";
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

  return <div className={styles.shell}>
    <ExistingDashboard/>
    <button className={styles.careerLauncher} type="button" onClick={() => changeView("career")}>
      <Search size={17}/><span>Career Intelligence</span><small>Career + ATS</small>
    </button>
    <button className={styles.hiringLauncher} type="button" onClick={() => changeView("hiring")}>
      <Flame size={17}/><span>Hiring Signals</span><small>KSA + UAE</small>
    </button>
    <Link className={styles.maqsamLauncher} href="/marita-calls">
      <PhoneCall size={17}/><span>Marita Calls</span><small>Maqsam</small>
    </Link>
  </div>;
}
