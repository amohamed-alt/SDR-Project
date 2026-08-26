"use client";

import { useState } from "react";
import { ArrowLeft, BrainCircuit, Database } from "lucide-react";
import { AccountIntelligence } from "@/components/AccountIntelligence";
import { TargetAccountPool } from "@/components/TargetAccountPool";
import styles from "./TalenteraIntelligenceWorkspace.module.css";

type WorkspaceTab = "priority" | "pool";

export function TalenteraIntelligenceWorkspace({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<WorkspaceTab>("priority");

  return <div className={styles.workspace}>
    <div className={styles.topbar}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={15}/> Dashboard</button>
      <div className={styles.tabs}>
        <button type="button" className={tab === "priority" ? styles.active : ""} onClick={() => setTab("priority")}>
          <BrainCircuit size={15}/><span><strong>Priority Accounts</strong><small>Marita · live company intelligence</small></span>
        </button>
        <button type="button" className={tab === "pool" ? styles.active : ""} onClick={() => setTab("pool")}>
          <Database size={15}/><span><strong>Target Account Pool</strong><small>Market stock · verify · feed Marita</small></span>
        </button>
      </div>
    </div>
    {tab === "priority" ? <AccountIntelligence onBack={onBack}/> : <TargetAccountPool/>}
  </div>;
}
