"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CircleAlert,
  Flame,
  Globe2,
  Link2,
  LoaderCircle,
  PhoneCall,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
  Users,
  Watch,
} from "lucide-react";
import { extractLinkedInUrlsFromFile } from "@/lib/linkedin-file-import";
import styles from "./ProspectingCockpit.module.css";

type ScoreReason = { label: string; points: number };
type HiringInsight = {
  status: "Hiring Now" | "Accepting Applications" | "No Active Jobs" | "Unknown";
  activeJobs: number;
  hiringScore: number;
  hiringLabel: string;
  hasHrJobs: boolean;
  source: string;
  sourceUrl: string;
  checkedAt: string;
  jobsSample: Array<{ title: string; location: string; url: string }>;
};
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
  companyDomain: string;
  companyLinkedIn: string;
  companySize: string;
  staffCount: number | string | null;
  industry: string;
  careerPageUrl: string;
  detectedAts: string;
  atsConfidence: string;
  careerConfidence: number;
  companyEvidenceUrl: string;
  companyVerificationReason: string;
  hiring: HiringInsight;
  currentRoleStarted: string;
  previousTitle: string;
  previousCompany: string;
  email: string;
  emails: string[];
  emailConfidence: number | null;
  phone: string;
  phones: string[];
  phoneConfidence: number | null;
  recentSignal: { type: string; label: string; ageDays?: number | null };
  score: number;
  priority: "high" | "medium" | "normal";
  scoreReasons: ScoreReason[];
  hubspot: { inHubSpot: boolean; id: string; matchedBy: string };
  hubspotContact?: { inHubSpot: boolean; id: string; matchedBy: string };
};

type AnalyzeResponse = {
  prospect?: Prospect;
  meta?: { creditsLeft?: number | null; smartleadConfigured?: boolean };
  error?: string;
};
type IntelligenceResponse = {
  patch?: Partial<Prospect>;
  error?: string;
};
type RuntimeStatus = {
  signalHireConfigured: boolean;
  smartleadConfigured: boolean;
  companyIntelligenceConfigured?: boolean;
  defaultSource: string;
};
type PushState = { loading?: boolean; success?: string; error?: string };
type BulkState = { loading: boolean; done: number; total: number };
type IntelligenceState = {
  status: "idle" | "loading" | "done" | "error";
  stage: string;
  error?: string;
};
type IntelligenceQueueItem = { prospect: Prospect; runId: number };

const MAX_IMPORT = 50;
const DEEP_INTELLIGENCE_CONCURRENCY = 2;

function urlsFromText(value: string) {
  const matches = value.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9%._~\-]+\/?/gi) || [];
  const normalized = matches.map((item) => {
    try {
      const url = new URL(/^https?:\/\//i.test(item) ? item : `https://${item}`);
      url.protocol = "https:";
      url.hostname = "www.linkedin.com";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }).filter(Boolean);
  return [...new Set(normalized)].slice(0, MAX_IMPORT);
}

function priorityLabel(priority: Prospect["priority"]) {
  if (priority === "high") return "High priority";
  if (priority === "medium") return "Medium priority";
  return "Normal";
}

function hiringClass(status: HiringInsight["status"]) {
  if (status === "Hiring Now") return styles.hiringHot;
  if (status === "No Active Jobs") return styles.hiringQuiet;
  return styles.hiringUnknown;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkState>({ loading: false, done: 0, total: 0 });
  const [importNote, setImportNote] = useState("");
  const [intelligence, setIntelligence] = useState<Record<string, IntelligenceState>>({});
  const intelligenceQueueRef = useRef<IntelligenceQueueItem[]>([]);
  const intelligenceWorkersRef = useRef(0);
  const runIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/prospecting/analyze", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: RuntimeStatus) => {
        setRuntime(payload);
        if (payload.defaultSource) setSource(payload.defaultSource);
      })
      .catch(() => setRuntime({
        signalHireConfigured: false,
        smartleadConfigured: false,
        defaultSource: "Sales Navigator",
      }));
  }, []);

  const urls = useMemo(() => urlsFromText(input), [input]);
  const highPriority = results.filter((item) => item.priority === "high").length;
  const existing = results.filter((item) => item.hubspot.inHubSpot).length;
  const hiringNow = results.filter((item) => item.hiring.status === "Hiring Now").length;
  const selectedProspects = results.filter((item) => selected.has(item.linkedinUrl));

  async function analyzeOne(linkedinUrl: string) {
    const response = await fetch("/api/prospecting/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedinUrl, source }),
    });
    const payload = await response.json() as AnalyzeResponse;
    if (!response.ok || !payload.prospect) {
      throw new Error(payload.error || `${linkedinUrl}: resolution failed`);
    }
    if (typeof payload.meta?.creditsLeft === "number") setCreditsLeft(payload.meta.creditsLeft);
    return payload.prospect;
  }

  async function enrichProspect(prospect: Prospect, runId: number) {
    if (runId !== runIdRef.current) return;
    const key = prospect.linkedinUrl;
    setIntelligence((current) => ({
      ...current,
      [key]: { status: "loading", stage: "Career + ATS + hiring + HubSpot" },
    }));

    try {
      const response = await fetch("/api/prospecting/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedinUrl: prospect.linkedinUrl,
          company: prospect.company,
          companyWebsite: prospect.companyWebsite,
          companyDomain: prospect.companyDomain,
          email: prospect.email,
          emails: prospect.emails,
          score: prospect.score,
          scoreReasons: prospect.scoreReasons,
        }),
      });
      const payload = await response.json() as IntelligenceResponse;
      if (!response.ok || !payload.patch) {
        throw new Error(payload.error || "Company intelligence failed.");
      }
      if (runId !== runIdRef.current) return;

      setResults((current) => current
        .map((item) => item.linkedinUrl === key ? { ...item, ...payload.patch } as Prospect : item)
        .sort((a, b) => b.score - a.score));
      setIntelligence((current) => ({
        ...current,
        [key]: { status: "done", stage: "Intelligence ready" },
      }));
    } catch (error) {
      if (runId !== runIdRef.current) return;
      setIntelligence((current) => ({
        ...current,
        [key]: {
          status: "error",
          stage: "Fast lead data ready",
          error: error instanceof Error ? error.message : "Company intelligence failed.",
        },
      }));
    }
  }

  function drainIntelligenceQueue() {
    while (
      intelligenceWorkersRef.current < DEEP_INTELLIGENCE_CONCURRENCY
      && intelligenceQueueRef.current.length > 0
    ) {
      const item = intelligenceQueueRef.current.shift();
      if (!item) return;
      intelligenceWorkersRef.current += 1;
      void enrichProspect(item.prospect, item.runId).finally(() => {
        intelligenceWorkersRef.current -= 1;
        drainIntelligenceQueue();
      });
    }
  }

  function queueIntelligence(prospect: Prospect, runId: number) {
    intelligenceQueueRef.current.push({ prospect, runId });
    drainIntelligenceQueue();
  }

  async function analyze() {
    if (!urls.length) {
      setErrors(["Add at least one LinkedIn profile URL or upload a list."]);
      return;
    }

    const runId = ++runIdRef.current;
    intelligenceQueueRef.current = [];
    setAnalyzing(true);
    setErrors([]);
    setResults([]);
    setSelected(new Set());
    setPushState({});
    setIntelligence({});
    setProgress({ done: 0, total: urls.length });

    const pending = [...urls];
    const failures: string[] = [];
    const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (pending.length) {
        const linkedinUrl = pending.shift();
        if (!linkedinUrl) return;
        try {
          const prospect = await analyzeOne(linkedinUrl);
          if (runId !== runIdRef.current) return;
          setResults((current) => [
            ...current.filter((item) => item.linkedinUrl !== prospect.linkedinUrl),
            prospect,
          ].sort((a, b) => b.score - a.score));
          queueIntelligence(prospect, runId);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `${linkedinUrl}: failed`);
          setErrors([...failures]);
        } finally {
          if (runId === runIdRef.current) {
            setProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }
      }
    });

    await Promise.all(workers);
    if (runId === runIdRef.current) setAnalyzing(false);
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
      const payload = await response.json() as {
        pushed?: boolean;
        duplicate?: boolean;
        taskId?: string;
        companyId?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(payload.error || "HubSpot push failed.");
      const message = payload.duplicate
        ? `Already queued · company synced · Task ${payload.taskId || "exists"}`
        : `Marita task created · company synced · ${payload.taskId || "done"}`;
      setPushState((current) => ({ ...current, [key]: { success: message } }));
      return true;
    } catch (error) {
      setPushState((current) => ({
        ...current,
        [key]: { error: error instanceof Error ? error.message : "HubSpot push failed." },
      }));
      return false;
    }
  }

  async function pushSelected() {
    const queue = selectedProspects.filter((prospect) => !pushState[prospect.linkedinUrl]?.success);
    if (!queue.length) return;
    setBulk({ loading: true, done: 0, total: queue.length });
    const pending = [...queue];
    const workers = Array.from({ length: Math.min(2, pending.length) }, async () => {
      while (pending.length) {
        const prospect = pending.shift();
        if (!prospect) return;
        await pushToMarita(prospect);
        setBulk((current) => ({ ...current, done: current.done + 1 }));
      }
    });
    await Promise.all(workers);
    setBulk((current) => ({ ...current, loading: false }));
  }

  function toggleSelect(linkedinUrl: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(linkedinUrl)) next.delete(linkedinUrl);
      else next.add(linkedinUrl);
      return next;
    });
  }

  function toggleWatch(prospect: Prospect) {
    setWatched((current) => {
      const next = new Set(current);
      if (next.has(prospect.linkedinUrl)) next.delete(prospect.linkedinUrl);
      else next.add(prospect.linkedinUrl);
      return next;
    });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportNote(`Reading ${file.name}…`);
    try {
      const imported = (await extractLinkedInUrlsFromFile(file)).slice(0, MAX_IMPORT);
      if (!imported.length) {
        throw new Error("I could not find a LinkedIn person URL column in this file.");
      }
      const merged = [...new Set([...urlsFromText(input), ...imported])].slice(0, MAX_IMPORT);
      setInput(merged.join("\n"));
      setImportNote(`${file.name}: found ${imported.length} LinkedIn profile URL${imported.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setImportNote(error instanceof Error ? error.message : "Unable to read this file.");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <Link href="/" className={styles.back}><ArrowLeft size={16} /> SDR Command Center</Link>
            <div className={styles.eyebrow}>PROSPECTING COCKPIT V2</div>
            <h1>Sales Navigator → Intelligence → Marita</h1>
            <p>Resolve people fast, then verify company domain, Career Page, ATS, hiring and HubSpot in the background while you keep working.</p>
          </div>
          <div className={styles.headerRight}>
            <Link href="/hiring" className={styles.headerButton}><BriefcaseBusiness size={16} /> Hiring Signals</Link>
            <div className={styles.runtime}>
              <span className={runtime?.signalHireConfigured ? styles.ok : styles.bad}>
                {runtime?.signalHireConfigured ? <ShieldCheck size={15} /> : <CircleAlert size={15} />}
                SignalHire {runtime?.signalHireConfigured ? "ready" : "needs key"}
              </span>
              <span className={runtime?.companyIntelligenceConfigured ? styles.ok : styles.muted}><Building2 size={15} /> Career + ATS</span>
              <span className={runtime?.smartleadConfigured ? styles.ok : styles.muted}><Send size={15} /> Smartlead {runtime?.smartleadConfigured ? "ready" : "later"}</span>
            </div>
          </div>
        </header>

        <section className={styles.importCard}>
          <div className={styles.importHeader}>
            <div>
              <div className={styles.sectionTitle}><Link2 size={18} /> Add LinkedIn leads</div>
              <p>Paste normal LinkedIn URLs or upload CSV, TSV, TXT, or XLSX. The file importer finds the LinkedIn profile column automatically.</p>
            </div>
            <label className={styles.sourceField}>
              <span>Source</span>
              <select value={source} onChange={(event) => setSource(event.target.value)}>
                <option>Sales Navigator</option>
                <option>LinkedIn URL</option>
                <option>File Import</option>
                <option>Manual Research</option>
                <option>Referral</option>
              </select>
            </label>
          </div>

          <div className={styles.inputActions}>
            <label className={styles.fileButton}>
              <Upload size={16} /> Upload lead file
              <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={importFile} />
            </label>
            {importNote && <span className={styles.importNote}>{importNote}</span>}
          </div>

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={"Paste LinkedIn profile links here — one per line"}
            spellCheck={false}
          />
          <div className={styles.importFooter}>
            <div className={styles.hint}>{urls.length} valid LinkedIn profile{urls.length === 1 ? "" : "s"} · max {MAX_IMPORT}</div>
            <button className={styles.primary} onClick={analyze} disabled={analyzing || !runtime?.signalHireConfigured || !urls.length}>
              {analyzing ? <LoaderCircle size={17} className={styles.spin} /> : <Sparkles size={17} />}
              {analyzing ? `Resolving leads ${progress.done}/${progress.total}` : "Analyze leads"}
            </button>
          </div>
        </section>

        {(results.length > 0 || errors.length > 0) && (
          <section className={styles.summary}>
            <div><Users size={18} /><strong>{results.length}</strong><span>Resolved</span></div>
            <div><Flame size={18} /><strong>{highPriority}</strong><span>High priority</span></div>
            <div><BriefcaseBusiness size={18} /><strong>{hiringNow}</strong><span>Hiring now</span></div>
            <div><CheckCircle2 size={18} /><strong>{existing}</strong><span>Already HubSpot</span></div>
            <div><Sparkles size={18} /><strong>{creditsLeft ?? "—"}</strong><span>SignalHire credits</span></div>
          </section>
        )}

        {results.length > 0 && (
          <section className={styles.bulkBar}>
            <div>
              <strong>{selected.size} selected</strong>
              <span>Lead cards are usable immediately; deep company intelligence continues in the background.</span>
            </div>
            <div className={styles.bulkActions}>
              <button className={styles.action} onClick={() => setSelected(new Set(results.map((item) => item.linkedinUrl)))}>Select all</button>
              <button className={styles.action} onClick={() => setSelected(new Set())}>Clear</button>
              <button className={styles.actionPrimary} onClick={pushSelected} disabled={!selected.size || bulk.loading}>
                {bulk.loading ? <LoaderCircle size={15} className={styles.spin} /> : <UserPlus size={15} />}
                {bulk.loading ? `Pushing ${bulk.done}/${bulk.total}` : `Push selected (${selected.size})`}
              </button>
            </div>
          </section>
        )}

        {errors.length > 0 && (
          <div className={styles.errors}>{errors.slice(0, 8).map((error) => <div key={error}><CircleAlert size={15} /> {error}</div>)}</div>
        )}

        <section className={styles.results}>
          {results.map((prospect) => {
            const state = pushState[prospect.linkedinUrl] || {};
            const intelligenceState = intelligence[prospect.linkedinUrl] || { status: "idle", stage: "" } as IntelligenceState;
            const intelligenceLoading = intelligenceState.status === "loading";
            const isWatched = watched.has(prospect.linkedinUrl);
            const isSelected = selected.has(prospect.linkedinUrl);
            return (
              <article className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`} key={prospect.linkedinUrl}>
                <div className={styles.cardTop}>
                  <div className={styles.identity}>
                    <label className={styles.selectBox} title="Select for bulk push">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(prospect.linkedinUrl)} />
                    </label>
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
                  <div className={styles.score}><strong>{prospect.score}</strong><span>/100</span></div>
                </div>

                <div className={styles.signals}>
                  <span className={prospect.recentSignal.type ? styles.signalHot : styles.signalNeutral}><Flame size={14} /> {prospect.recentSignal.label || "No recent job-change signal"}</span>
                  <span className={intelligenceLoading ? styles.hiringUnknown : hiringClass(prospect.hiring.status)}>
                    {intelligenceLoading ? <LoaderCircle size={14} className={styles.spin} /> : <BriefcaseBusiness size={14} />}
                    {intelligenceLoading ? "Hiring · checking…" : `${prospect.hiring.status}${prospect.hiring.status === "Hiring Now" ? ` · ${prospect.hiring.activeJobs} jobs` : ""}`}
                  </span>
                  <span><Users size={14} /> {prospect.companySize || (prospect.staffCount ? `${prospect.staffCount} staff` : "Size unknown")}</span>
                  <span>
                    <ShieldCheck size={14} />
                    {intelligenceLoading && !prospect.hubspot.matchedBy
                      ? "HubSpot · checking…"
                      : prospect.hubspot.inHubSpot
                        ? `HubSpot · ${prospect.hubspot.matchedBy}`
                        : "New to HubSpot"}
                  </span>
                </div>

                <div className={styles.companyPanel}>
                  <div className={styles.companyPanelTitle}>
                    <Building2 size={16} />
                    <strong>Company Intelligence</strong>
                    {intelligenceState.status === "loading" && (
                      <span className={styles.muted} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 999, fontSize: 10, fontWeight: 800 }}>
                        <LoaderCircle size={12} className={styles.spin} /> Background enrichment
                      </span>
                    )}
                    {intelligenceState.status === "done" && (
                      <span className={styles.ok} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 999, fontSize: 10, fontWeight: 800 }}>
                        <CheckCircle2 size={12} /> Ready
                      </span>
                    )}
                    {intelligenceState.status === "error" && (
                      <span className={styles.bad} title={intelligenceState.error} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 999, fontSize: 10, fontWeight: 800 }}>
                        <CircleAlert size={12} /> Partial
                      </span>
                    )}
                  </div>
                  <div className={styles.companyGrid}>
                    <div>
                      <span>Domain</span>
                      <strong>{prospect.companyDomain || (intelligenceLoading ? "Resolving…" : "Not resolved")}</strong>
                    </div>
                    <div>
                      <span>ATS</span>
                      <strong>{prospect.detectedAts || (intelligenceLoading ? "Checking…" : "Not detected")}</strong>
                    </div>
                    <div>
                      <span>Career Page</span>
                      {prospect.careerPageUrl
                        ? <a href={prospect.careerPageUrl} target="_blank" rel="noreferrer">Open verified page</a>
                        : <strong>{intelligenceLoading ? "Checking…" : "Not found"}</strong>}
                    </div>
                    <div>
                      <span>Hiring</span>
                      <strong>{intelligenceLoading ? "Checking…" : `${prospect.hiring.status}${prospect.hiring.activeJobs ? ` · ${prospect.hiring.activeJobs} roles` : ""}`}</strong>
                    </div>
                  </div>
                  {prospect.hiring.jobsSample.length > 0 && (
                    <div className={styles.jobSamples}>
                      {prospect.hiring.jobsSample.slice(0, 3).map((job) => (
                        <a key={`${job.title}-${job.url}`} href={job.url} target="_blank" rel="noreferrer">
                          <BriefcaseBusiness size={13} /> {job.title}{job.location ? ` · ${job.location}` : ""}
                        </a>
                      ))}
                    </div>
                  )}
                  {intelligenceState.status === "error" && intelligenceState.error && (
                    <div className={styles.inlineError}><CircleAlert size={15} /> Deep intelligence: {intelligenceState.error}</div>
                  )}
                </div>

                <div className={styles.grid}>
                  <div><span>Email</span><strong>{prospect.email || "Not found"}</strong></div>
                  <div><span>Phone</span><strong>{prospect.phone || "Not found"}</strong></div>
                  <div><span>Industry</span><strong>{prospect.industry || "—"}</strong></div>
                  <div><span>Source</span><strong>{prospect.source}</strong></div>
                </div>

                {prospect.scoreReasons.length > 0 && (
                  <div className={styles.reasons}>
                    {prospect.scoreReasons.map((reason) => (
                      <span key={`${reason.label}-${reason.points}`}>{reason.label} <b>+{reason.points}</b></span>
                    ))}
                  </div>
                )}

                <div className={styles.actions}>
                  <button className={styles.actionPrimary} onClick={() => pushToMarita(prospect)} disabled={state.loading}>
                    {state.loading ? <LoaderCircle size={15} className={styles.spin} /> : <UserPlus size={15} />} Push to Marita
                  </button>
                  <button className={isWatched ? styles.actionActive : styles.action} onClick={() => toggleWatch(prospect)}>
                    <Watch size={15} /> {isWatched ? "Watching" : "Watch"}
                  </button>
                  <button
                    className={styles.action}
                    disabled={!runtime?.smartleadConfigured}
                    title={runtime?.smartleadConfigured ? "Smartlead campaign selection will be wired next." : "Smartlead is intentionally postponed."}
                  >
                    <Send size={15} /> Smartlead
                  </button>
                  {prospect.companyWebsite && (
                    <a className={styles.action} href={prospect.companyWebsite} target="_blank" rel="noreferrer"><Globe2 size={15} /> Company</a>
                  )}
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
