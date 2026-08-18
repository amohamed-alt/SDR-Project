"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Flame,
  Link2,
  LoaderCircle,
  PhoneCall,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Watch,
} from "lucide-react";
import styles from "./ProspectingCockpit.module.css";

type ScoreReason = { label: string; points: number };
type Prospect = {
  uid: string;
  linkedinUrl: string;
  source: string;
  fullName: string;
  headline: string;
  photoUrl: string;
  location: string;
  title: string;
  company: string;
  companyWebsite: string;
  companyLinkedIn: string;
  companySize: string;
  staffCount: number | string | null;
  industry: string;
  currentRoleStarted: string;
  previousTitle: string;
  previousCompany: string;
  email: string;
  emailConfidence: number | null;
  phone: string;
  phoneConfidence: number | null;
  recentSignal: { type: string; label: string; ageDays?: number | null };
  score: number;
  priority: "high" | "medium" | "normal";
  scoreReasons: ScoreReason[];
  hubspot: { inHubSpot: boolean; id: string; matchedBy: string };
};

type AnalyzeResponse = {
  prospect?: Prospect;
  meta?: { creditsLeft?: number | null; smartleadConfigured?: boolean };
  error?: string;
};

type RuntimeStatus = {
  signalHireConfigured: boolean;
  smartleadConfigured: boolean;
  defaultSource: string;
};

type PushState = { loading?: boolean; success?: string; error?: string };

const MAX_IMPORT = 50;

function urlsFromText(value: string) {
  const candidates = value.split(/[\n,;\t ]+/).map((item) => item.trim()).filter(Boolean);
  return [...new Set(candidates)].filter((item) => /linkedin\.com\/in\//i.test(item)).slice(0, MAX_IMPORT);
}

function priorityLabel(priority: Prospect["priority"]) {
  if (priority === "high") return "High priority";
  if (priority === "medium") return "Medium priority";
  return "Normal";
}

export function ProspectingCockpit() {
  const [input, setInput] = useState("");
  const [source, setSource] = useState("Sales Navigator");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [results, setResults] = useState<Prospect[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const [pushState, setPushState] = useState<Record<string, PushState>>({});
  const [watched, setWatched] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/prospecting/analyze", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: RuntimeStatus) => {
        setRuntime(payload);
        if (payload.defaultSource) setSource(payload.defaultSource);
      })
      .catch(() => setRuntime({ signalHireConfigured: false, smartleadConfigured: false, defaultSource: "Sales Navigator" }));
  }, []);

  const urls = useMemo(() => urlsFromText(input), [input]);
  const highPriority = results.filter((item) => item.priority === "high").length;
  const existing = results.filter((item) => item.hubspot.inHubSpot).length;

  async function analyzeOne(linkedinUrl: string) {
    const response = await fetch("/api/prospecting/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedinUrl, source }),
    });
    const payload = await response.json() as AnalyzeResponse;
    if (!response.ok || !payload.prospect) throw new Error(payload.error || `${linkedinUrl}: analysis failed`);
    if (typeof payload.meta?.creditsLeft === "number") setCreditsLeft(payload.meta.creditsLeft);
    return payload.prospect;
  }

  async function analyze() {
    if (!urls.length) {
      setErrors(["Paste at least one LinkedIn person URL (linkedin.com/in/...)."]);
      return;
    }
    setAnalyzing(true);
    setErrors([]);
    setResults([]);
    setProgress({ done: 0, total: urls.length });

    const pending = [...urls];
    const found: Prospect[] = [];
    const failures: string[] = [];
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length) {
        const linkedinUrl = pending.shift();
        if (!linkedinUrl) return;
        try {
          const prospect = await analyzeOne(linkedinUrl);
          found.push(prospect);
          setResults([...found].sort((a, b) => b.score - a.score));
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `${linkedinUrl}: failed`);
          setErrors([...failures]);
        } finally {
          setProgress((current) => ({ ...current, done: current.done + 1 }));
        }
      }
    });

    await Promise.all(workers);
    setAnalyzing(false);
  }

  async function pushToMarita(prospect: Prospect) {
    const key = prospect.linkedinUrl;
    setPushState((current) => ({ ...current, [key]: { loading: true } }));
    try {
      const response = await fetch("/api/prospecting/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prospect),
      });
      const payload = await response.json() as { pushed?: boolean; duplicate?: boolean; taskId?: string; error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "HubSpot push failed.");
      const message = payload.duplicate
        ? `Already queued · Task ${payload.taskId || "exists"}`
        : `Marita task created · ${payload.taskId || "done"}`;
      setPushState((current) => ({ ...current, [key]: { success: message } }));
    } catch (error) {
      setPushState((current) => ({ ...current, [key]: { error: error instanceof Error ? error.message : "HubSpot push failed." } }));
    }
  }

  function toggleWatch(prospect: Prospect) {
    setWatched((current) => {
      const next = new Set(current);
      if (next.has(prospect.linkedinUrl)) next.delete(prospect.linkedinUrl);
      else next.add(prospect.linkedinUrl);
      return next;
    });
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <Link href="/" className={styles.back}><ArrowLeft size={16} /> SDR Command Center</Link>
            <div className={styles.eyebrow}>PROSPECTING COCKPIT</div>
            <h1>Sales Navigator → SignalHire → Marita</h1>
            <p>Paste LinkedIn people URLs, enrich them, score the buying signal, check HubSpot, then route the best prospects to Marita.</p>
          </div>
          <div className={styles.runtime}>
            <span className={runtime?.signalHireConfigured ? styles.ok : styles.bad}>
              {runtime?.signalHireConfigured ? <ShieldCheck size={15} /> : <CircleAlert size={15} />}
              SignalHire {runtime?.signalHireConfigured ? "ready" : "needs key"}
            </span>
            <span className={runtime?.smartleadConfigured ? styles.ok : styles.muted}>
              <Send size={15} /> Smartlead {runtime?.smartleadConfigured ? "ready" : "optional"}
            </span>
          </div>
        </header>

        <section className={styles.importCard}>
          <div className={styles.importHeader}>
            <div>
              <div className={styles.sectionTitle}><Link2 size={18} /> Add LinkedIn leads</div>
              <p>Single URL or paste up to {MAX_IMPORT} profiles at once.</p>
            </div>
            <label>
              <span>Source</span>
              <select value={source} onChange={(event) => setSource(event.target.value)}>
                <option>Sales Navigator</option>
                <option>LinkedIn URL</option>
                <option>Manual Research</option>
                <option>Referral</option>
              </select>
            </label>
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={"https://www.linkedin.com/in/person-one\nhttps://www.linkedin.com/in/person-two"}
          />
          <div className={styles.importFooter}>
            <div className={styles.hint}>{urls.length} valid LinkedIn URL{urls.length === 1 ? "" : "s"}</div>
            <button className={styles.primary} onClick={analyze} disabled={analyzing || !runtime?.signalHireConfigured || !urls.length}>
              {analyzing ? <LoaderCircle size={17} className={styles.spin} /> : <Sparkles size={17} />}
              {analyzing ? `Analyzing ${progress.done}/${progress.total}` : "Analyze leads"}
            </button>
          </div>
        </section>

        {(results.length > 0 || errors.length > 0) && (
          <section className={styles.summary}>
            <div><Users size={18} /><strong>{results.length}</strong><span>Resolved</span></div>
            <div><Flame size={18} /><strong>{highPriority}</strong><span>High priority</span></div>
            <div><CheckCircle2 size={18} /><strong>{existing}</strong><span>Already HubSpot</span></div>
            <div><Sparkles size={18} /><strong>{creditsLeft ?? "—"}</strong><span>SignalHire credits left</span></div>
          </section>
        )}

        {errors.length > 0 && (
          <div className={styles.errors}>
            {errors.slice(0, 8).map((error) => <div key={error}><CircleAlert size={15} /> {error}</div>)}
          </div>
        )}

        <section className={styles.results}>
          {results.map((prospect) => {
            const state = pushState[prospect.linkedinUrl] || {};
            const isWatched = watched.has(prospect.linkedinUrl);
            return (
              <article className={styles.card} key={prospect.linkedinUrl}>
                <div className={styles.cardTop}>
                  <div className={styles.identity}>
                    <div className={styles.avatar}>{prospect.fullName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <div className={styles.nameLine}>
                        <h2>{prospect.fullName}</h2>
                        <span className={`${styles.priority} ${styles[prospect.priority]}`}>{priorityLabel(prospect.priority)}</span>
                      </div>
                      <p>{prospect.title || prospect.headline || "Title unavailable"}</p>
                      <span>{prospect.company || "Company unavailable"}{prospect.location ? ` · ${prospect.location}` : ""}</span>
                    </div>
                  </div>
                  <div className={styles.score}>
                    <strong>{prospect.score}</strong><span>/100</span>
                  </div>
                </div>

                <div className={styles.signals}>
                  <span className={prospect.recentSignal.type ? styles.signalHot : styles.signalNeutral}>
                    <Flame size={14} /> {prospect.recentSignal.label || "No recent job-change signal"}
                  </span>
                  <span><Users size={14} /> {prospect.companySize || (prospect.staffCount ? `${prospect.staffCount} staff` : "Size unknown")}</span>
                  <span><ShieldCheck size={14} /> {prospect.hubspot.inHubSpot ? `HubSpot · ${prospect.hubspot.matchedBy}` : "New to HubSpot"}</span>
                </div>

                <div className={styles.grid}>
                  <div><span>Email</span><strong>{prospect.email || "Not found"}</strong></div>
                  <div><span>Phone</span><strong>{prospect.phone || "Not found"}</strong></div>
                  <div><span>Industry</span><strong>{prospect.industry || "—"}</strong></div>
                  <div><span>Source</span><strong>{prospect.source}</strong></div>
                </div>

                {prospect.scoreReasons.length > 0 && (
                  <div className={styles.reasons}>
                    {prospect.scoreReasons.map((reason) => <span key={`${reason.label}-${reason.points}`}>{reason.label} <b>+{reason.points}</b></span>)}
                  </div>
                )}

                <div className={styles.actions}>
                  <button className={styles.actionPrimary} onClick={() => pushToMarita(prospect)} disabled={state.loading}>
                    {state.loading ? <LoaderCircle size={15} className={styles.spin} /> : <UserPlus size={15} />}
                    Push to Marita
                  </button>
                  <button className={isWatched ? styles.actionActive : styles.action} onClick={() => toggleWatch(prospect)}>
                    <Watch size={15} /> {isWatched ? "Watching" : "Watch"}
                  </button>
                  <button className={styles.action} disabled={!runtime?.smartleadConfigured} title={runtime?.smartleadConfigured ? "Smartlead action will be wired to campaign selection next." : "Add SMARTLEAD_API_KEY first."}>
                    <Send size={15} /> {runtime?.smartleadConfigured ? "Smartlead" : "Smartlead · add key"}
                  </button>
                  {prospect.phone && <a className={styles.action} href={`tel:${prospect.phone}`}><PhoneCall size={15} /> Call</a>}
                  <a className={styles.action} href={prospect.linkedinUrl} target="_blank" rel="noreferrer"><Link2 size={15} /> LinkedIn</a>
                </div>

                {state.success && <div className={styles.success}><CheckCircle2 size={15} /> {state.success}</div>}
                {state.error && <div className={styles.inlineError}><CircleAlert size={15} /> {state.error}</div>}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
