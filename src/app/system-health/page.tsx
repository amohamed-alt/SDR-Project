import { Activity, ArrowLeft, Info, RefreshCw, ShieldCheck } from "lucide-react";
import { getSystemHealth } from "@/lib/system-health";
import styles from "./system-health.module.css";

export const dynamic = "force-dynamic";

function StatusPill({ status }: { status: string }) {
  const tone = ["ok", "configured", "optional", "disabled", "incomplete", "missing", "unavailable"].includes(status) ? status : "optional";
  return <span className={`${styles.status} ${styles[tone]}`}>{status}</span>;
}

function dateTime(value: string | number | null) {
  if (!value) return "No snapshot yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default async function SystemHealthPage() {
  const health = await getSystemHealth();
  const cache = health.core.dashboardCache;
  const integrations = [
    ["Google Calendar", health.integrations.googleCalendar.status, health.integrations.googleCalendar.tokenStorePresent ? "Organizer token store present" : "No organizer token store detected"],
    ["SignalHire", health.integrations.signalHire.status, "Contact enrichment"],
    ["MillionVerifier", health.integrations.millionVerifier.status, "Email verification"],
    ["Apollo", health.integrations.apollo.status, "Prospecting data"],
    ["Tavily", health.integrations.tavily.status, "Research search"],
    ["Gemini", health.integrations.gemini.status, "AI research"],
    ["OpenRouter", health.integrations.openRouter.status, "AI routing"],
    ["Maqsam", health.integrations.maqsam.status, "Call synchronization"],
  ] as const;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>GTM COMMAND CENTER · OPERATIONS</span><h1>System Health</h1><p>Safe operational visibility across the dashboard runtime, cache layer, Postgres-backed services and configured integrations. No credentials are exposed here.</p></div>
        <div className={styles.actions}><a href="/"><ArrowLeft size={14}/>Dashboard</a><a href="/system-health"><RefreshCw size={14}/>Run check</a></div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroMain}><span className={styles.heroIcon}>{health.status === "ok" ? <ShieldCheck size={23}/> : <Activity size={23}/>}</span><div><h2>{health.status === "ok" ? "Core GTM systems are operational" : "Core system attention required"}</h2><p>Live bounded health check · generated {dateTime(health.timestamp)}</p></div></div>
        <div className={styles.heroMeta}><StatusPill status={health.status}/><span>Build</span><code title={health.buildRef}>{health.buildRef.slice(0, 12)}</code></div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>Core runtime</h2><p>The services that must remain healthy for normal SDR dashboard operation.</p></div></div>
        <div className={styles.grid}>
          <article className={styles.card}><div className={styles.cardTop}><strong>Next.js application</strong><StatusPill status={health.core.application.status}/></div><div className={styles.cardValue}>Online</div><div className={styles.cardMeta}>Revision {health.buildRef.slice(0, 12)}</div></article>
          <article className={styles.card}><div className={styles.cardTop}><strong>HubSpot CRM</strong><StatusPill status={health.core.hubspot.status}/></div><div className={styles.cardValue}>{health.core.hubspot.status === "configured" ? "Ready" : "Missing"}</div><div className={styles.cardMeta}>Configuration presence only; this check does not spend HubSpot API quota.</div></article>
          <article className={styles.card}><div className={styles.cardTop}><strong>Dashboard cache</strong><StatusPill status={cache.status}/></div><div className={styles.cardValue}>{cache.latencyMs} ms</div><div className={styles.cardMeta}>v{cache.version ?? "—"} · {cache.entries ?? 0} snapshots · newest {dateTime(cache.newestStoredAt)}</div></article>
          <article className={styles.card}><div className={styles.cardTop}><strong>Postgres data layer</strong><StatusPill status={health.core.postgres.status}/></div><div className={styles.cardValue}>{health.core.postgres.status === "ok" ? "Connected" : health.core.postgres.status}</div><div className={styles.cardMeta}>{health.core.postgres.source}</div></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>Access & control plane</h2><p>Configuration readiness for dashboard and controlled administrative actions.</p></div></div>
        <div className={styles.grid}>
          <article className={styles.card}><div className={styles.cardTop}><strong>Dashboard access</strong><StatusPill status={health.access.dashboardAuth.status}/></div><div className={styles.cardValue}>{health.access.dashboardAuth.mode}</div><div className={styles.cardMeta}>Current access mode as resolved by the server.</div></article>
          <article className={styles.card}><div className={styles.cardTop}><strong>SDR admin actions</strong><StatusPill status={health.access.sdrAdmin.status}/></div><div className={styles.cardValue}>{health.access.sdrAdmin.status === "configured" ? "Ready" : "Missing"}</div><div className={styles.cardMeta}>Only configuration readiness is shown; the admin credential never leaves the server.</div></article>
          <article className={styles.card}><div className={styles.cardTop}><strong>Cache acquisition DB</strong><StatusPill status={cache.acquisitionDatabase}/></div><div className={styles.cardValue}>{cache.acquisitionDatabase}</div><div className={styles.cardMeta}>Postgres-backed acquisition state reported by dashboard-cache.</div></article>
          <article className={styles.card}><div className={styles.cardTop}><strong>Cache usage DB</strong><StatusPill status={cache.usageDatabase}/></div><div className={styles.cardValue}>{cache.usageDatabase}</div><div className={styles.cardMeta}>Usage/analytics Postgres check reported by dashboard-cache.</div></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>Optional GTM integrations</h2><p>Configured means the required server-side credential is present. Optional does not indicate a failure.</p></div></div>
        <div className={styles.integrations}>{integrations.map(([label, status, detail]) => <article className={styles.integration} key={label}><div><strong>{label}</strong><div className={styles.cardMeta}>{detail}</div></div><StatusPill status={status}/></article>)}</div>
      </section>

      <div className={styles.note}><Info size={16}/><span>This page deliberately performs a cheap cache health request and configuration checks only. It does not run a full HubSpot scan, browser automation, or recurring polling, so opening it should not create meaningful VPS CPU load.</span></div>
    </div>
  </main>;
}
