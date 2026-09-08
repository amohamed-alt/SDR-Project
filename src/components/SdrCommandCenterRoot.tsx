"use client";

import { useEffect, useState } from "react";
import { BarChart3, MessageCircle, Sparkles, UserRound } from "lucide-react";
import { AcquisitionDashboard } from "@/components/AcquisitionDashboard";
import {
  preloadSdrTeamData,
  SdrTeamCommandCenter,
  type SdrTeamView,
} from "@/components/SdrTeamCommandCenter";
import styles from "@/components/SdrCommandCenterRoot.module.css";

type RootMode = "marita" | SdrTeamView;

function modeFromUrl(): RootMode {
  if (typeof window === "undefined") return "marita";
  const value = new URLSearchParams(window.location.search).get("sdr");
  if (value === "daniel" || value === "management") return value;
  return "marita";
}

function modeLabel(mode: RootMode) {
  if (mode === "daniel") return "Daniel · Evalufy";
  if (mode === "management") return "Management";
  return "Marita · Talentera";
}

export function SdrCommandCenterRoot() {
  const [mode, setMode] = useState<RootMode>("marita");

  useEffect(() => {
    const syncTimer = window.setTimeout(() => setMode(modeFromUrl()), 0);
    const preloadTimer = window.setTimeout(() => void preloadSdrTeamData(), 250);
    const onPopState = () => setMode(modeFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearTimeout(syncTimer);
      window.clearTimeout(preloadTimer);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  function changeMode(next: RootMode) {
    const url = new URL(window.location.href);
    url.searchParams.delete("legacy");
    url.searchParams.delete("previewOwner");
    url.searchParams.delete("acq");
    url.searchParams.delete("view");
    if (next === "marita") url.searchParams.delete("sdr");
    else url.searchParams.set("sdr", next);
    window.history.pushState({}, "", url);
    setMode(next);
    window.dispatchEvent(new CustomEvent("sdr:usage", {
      detail: { eventType: "feature_open", feature: `sdr-${next}` },
    }));
  }

  return <div className={styles.root} data-sdr-mode={mode}>
    {mode === "marita"
      ? <AcquisitionDashboard/>
      : <SdrTeamCommandCenter view={mode} onOpenMarita={() => changeMode("marita")}/>} 

    <aside className={styles.switcher} aria-label="SDR workspace switcher">
      <div className={styles.switcherHeader}>
        <span><i/>SDR LIVE</span>
        <strong>{modeLabel(mode)}</strong>
      </div>
      <div className={styles.switcherActions}>
        <button
          type="button"
          className={mode === "marita" ? styles.activeMarita : ""}
          onClick={() => changeMode("marita")}
          aria-pressed={mode === "marita"}
          title="Open Marita Talentera dashboard"
        >
          <span className={styles.personIcon}>MC</span>
          <span><strong>Marita</strong><small>Talentera</small></span>
        </button>
        <button
          type="button"
          className={mode === "daniel" ? styles.activeDaniel : ""}
          onClick={() => changeMode("daniel")}
          aria-pressed={mode === "daniel"}
          title="Open Daniel Evalufy workspace"
        >
          <span className={`${styles.personIcon} ${styles.danielIcon}`}>DB</span>
          <span><strong>Daniel</strong><small>Evalufy</small></span>
        </button>
        <button
          type="button"
          className={mode === "management" ? styles.activeManagement : ""}
          onClick={() => changeMode("management")}
          aria-pressed={mode === "management"}
          title="Open management overview"
        >
          <BarChart3 size={16}/>
          <span><strong>Overview</strong><small>Management</small></span>
        </button>
      </div>
      <div className={styles.switcherFooter}>
        <span><MessageCircle size={12}/>WhatsApp enabled</span>
        <span><Sparkles size={12}/>Prewarmed</span>
      </div>
    </aside>

    <div className={styles.mobileModeBadge}><UserRound size={13}/>{modeLabel(mode)}</div>
  </div>;
}
