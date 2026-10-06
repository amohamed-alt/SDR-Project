"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import styles from "./DecisionStudio.module.css";

const tools = [
  { name: "Account intelligence", goal: "Decide which account deserves the next call", detail: "Talentera / Marita scope: fit, hiring signals, ATS evidence and an account brief.", feature: "gtm-brain", view: "gtm-brain" },
  { name: "Sales handoff", goal: "Turn booked meetings into a clear next step", detail: "Booking SDR → RM attribution, follow-up timing and associated deals.", feature: "sales-handoff", view: "sales-handoff" },
  { name: "Call intelligence", goal: "Understand what happened in the conversation", detail: "Maqsam calls, transcripts and the existing sync workflow.", feature: "maqsam", view: "maqsam" },
  { name: "Lead inventory", goal: "Use the accounts you already have", detail: "Company stock, qualification and source coverage before sourcing more.", feature: "lead-inventory", view: "inventory" },
  { name: "Prospecting coverage", goal: "Find gaps in approved target markets", detail: "Market coverage and deduplication before enrichment.", feature: "net-new", view: "net-new" },
  { name: "Team adoption", goal: "See which tools are actually being used", detail: "Usage events and workspace adoption; usage is not sales impact.", feature: "team-activity", view: "team-activity" },
];
export function ToolStudio({ ownerKey }: { ownerKey: "marita" | "daniel" }) {
  const [usage, setUsage] = useState<Array<{ feature: string; events: number; users: number }> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/usage", { signal: controller.signal }).then(response => response.json()).then(payload => {
      if (payload.tracking && !payload.unavailable) setUsage(payload.topFeatures || []); else setUnavailable(true);
    }).catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, []);
  function open(view: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("acq", ownerKey); url.searchParams.set("view", view); url.searchParams.delete("studio");
    window.history.pushState({}, "", url); window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new CustomEvent("sdr:usage", { detail: { eventType: "feature_open", feature: view } }));
  }
  return <section className={styles.panel}><header><div><span className={styles.kicker}>Tools with a purpose</span><h2>Choose the outcome you need.</h2><p>Existing workflows, organized around daily SDR decisions. Administrative write tools remain in their protected workspace.</p></div></header><div className={styles.tools}>{tools.map(tool => {
    const metric = usage?.find(row => row.feature === tool.feature || row.feature === tool.view);
    return <article key={tool.name}><div><span className={styles.kicker}>{tool.name}</span><h3>{tool.goal}</h3><p>{tool.detail}</p><small>{metric ? `${metric.events} recorded events · ${metric.users} users in the usage service summary` : unavailable ? "Usage data unavailable" : usage ? "No recorded usage in the current summary" : "Loading recorded usage…"}</small></div><button type="button" onClick={() => open(tool.view)} aria-label={`Open ${tool.name}`}>Open <ArrowUpRight size={14}/></button></article>;
  })}</div><div className={styles.notice}>Usage counts describe adoption, not ROI. Validate meetings, qualified opportunities and time saved before retiring or expanding a tool.</div></section>;
}
