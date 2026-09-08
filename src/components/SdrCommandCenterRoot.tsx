"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { AcquisitionDashboard } from "@/components/AcquisitionDashboard";
import { SdrTeamCommandCenter } from "@/components/SdrTeamCommandCenter";
import styles from "@/components/SdrCommandCenterRoot.module.css";

type RootMode = "team" | "legacy";

function modeFromUrl(): RootMode {
  if (typeof window === "undefined") return "team";
  return new URLSearchParams(window.location.search).get("legacy") === "1" ? "legacy" : "team";
}

export function SdrCommandCenterRoot() {
  const [mode, setMode] = useState<RootMode>("team");

  useEffect(() => {
    setMode(modeFromUrl());
  }, []);

  function openLegacy(ownerId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("legacy", "1");
    url.searchParams.set("previewOwner", ownerId);
    window.history.pushState({}, "", url);
    setMode("legacy");
  }

  function openTeam() {
    const url = new URL(window.location.href);
    url.searchParams.delete("legacy");
    url.searchParams.delete("previewOwner");
    url.searchParams.delete("acq");
    url.searchParams.delete("view");
    window.history.pushState({}, "", url);
    setMode("team");
  }

  if (mode === "legacy") {
    return <div className={styles.legacyWrap}>
      <div className={styles.previewNotice}>
        <div><LayoutDashboard size={17}/><span><strong>Preview mode</strong> · Existing dashboard is still available for comparison. Nothing on this branch is in production.</span></div>
        <button type="button" onClick={openTeam}><ArrowLeft size={14}/>Back to new team dashboard</button>
      </div>
      <AcquisitionDashboard/>
    </div>;
  }

  return <SdrTeamCommandCenter onOpenAnalytics={openLegacy}/>;
}
