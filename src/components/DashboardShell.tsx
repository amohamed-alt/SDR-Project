"use client";

import { useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { Dashboard as ExistingDashboard } from "@/components/DashboardMotion";
import { MaqsamCallsDashboard } from "@/components/MaqsamCallsDashboard";
import styles from "@/components/DashboardShell.module.css";

export function Dashboard() {
  const [showMaqsam, setShowMaqsam] = useState(false);

  useEffect(() => {
    const syncFromUrl = () => setShowMaqsam(new URLSearchParams(window.location.search).get("view") === "maqsam");
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  function changeView(next: "core" | "maqsam") {
    const url = new URL(window.location.href);
    if (next === "maqsam") url.searchParams.set("view", "maqsam");
    else url.searchParams.delete("view");
    window.history.pushState({}, "", url);
    setShowMaqsam(next === "maqsam");
  }

  if (showMaqsam) return <MaqsamCallsDashboard onBack={() => changeView("core")}/>;

  return <div className={styles.shell}>
    <ExistingDashboard/>
    <button type="button" className={styles.maqsamLauncher} onClick={() => changeView("maqsam")}>
      <PhoneCall size={17}/>Maqsam Calls
    </button>
  </div>;
}
