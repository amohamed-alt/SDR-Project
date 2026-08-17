"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clipboard,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import styles from "./GTMResearchWorkspace.module.css";

type StageKey = "company" | "human" | "tam" | "icp" | "personas" | "sourcing" | "filters" | "copy" | "channels";
type StageStatus = "idle" | "draft" | "approved";

type StageState = {
  status: StageStatus;
  text: string;
  data: unknown;
  meta?: {
    ai?: string;
    model?: string;
    sources?: string[];
    warning?: string;
  };
};

type WorkspaceState = {
  domain: string;
  activeStage: StageKey;
  stages: Record<StageKey, StageState>;
};

const STORAGE_KEY = "talentera-gtm-research-workspace-v1";

const STAGES: Array<{ key: StageKey; label: string; eyebrow: string; description: string }> = [
  { key: "company", label: "Company Research", eyebrow: "01", description: "Deep company analysis, value proposition, pains and competitors." },
  { key: "human", label: "Human Overview", eyebrow: "02", description: "Your corrections become the operating truth for every next stage." },
  { key: "tam", label: "TAM Research", eyebrow: "03", description: "Markets, industries, employee bands, exclusions and assumptions." },
  { key: "icp", label: "ICP · 3 Tiers", eyebrow: "04", description: "Tier 1 best-fit, Tier 2 good-fit and Tier 3 experimental accounts." },
  { key: "personas", label: "Personas", eyebrow: "05", description: "Decision makers, champions, pains, KPIs, triggers and objections." },
  { key: "sourcing", label: "Sourcing Tools", eyebrow: "06", description: "Recommended sourcing and enrichment stack based on the ICP." },
  { key: "filters", label: "Tool Filters", eyebrow: "07", description: "Copy-ready Sales Navigator and Apollo filtering logic." },
  { key: "copy", label: "Copywriting", eyebrow: "08", description: "First, second and third touch for email and LinkedIn." },
  { key: "channels", label: "Outreach Channels", eyebrow: "09", description: "Recommended channel mix, sequence and cadence." },
];

function emptyStage(): StageState {
  return { status: "idle", text: "", data: null };
}

function initialState(): WorkspaceState {
  return {
    domain: "",
    activeStage: "company",
    stages: {
      company: emptyStage(),
      human: emptyStage(),
      tam: emptyStage(),
      icp: emptyStage(),
      personas: emptyStage(),
      sourcing: emptyStage(),
      filters: emptyStage(),
      copy: emptyStage(),
      channels: emptyStage(),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function companyOverview(data: unknown) {
  if (!isRecord(data)) return "";
  const line = (label: string, value: unknown) => {
    if (Array.isArray(value)) return `${label}: ${value.map(String).join(", ")}`;
    if (typeof value === "string" && value.trim()) return `${label}: ${value}`;
    return "";
  };
  return [
    line("Company", data.company_name),
    line("Summary", data.summary),
    line("Primary markets", data.primary_markets),
    line("Target customers", data.target_customer_types),
    "",
    "Human corrections / operating truth:",
    "Add or correct anything the AI misunderstood. Example: Primary focus is Saudi Arabia and UAE, not the USA.",
  ].filter((item, index, all) => item || (index > 0 && all[index - 1])).join("\n");
}

export function GTMResearchWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialState);
  const storageReady = useRef(false);
  const [loadingStage, setLoadingStage] = useState<StageKey | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) setWorkspace(JSON.parse(saved) as WorkspaceState);
      } catch {
        // Ignore invalid browser state and start clean.
      } finally {
        storageReady.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady.current) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  const activeIndex = STAGES.findIndex((stage) => stage.key === workspace.activeStage);
  const activeDefinition = STAGES[activeIndex];
  const activeState = workspace.stages[workspace.activeStage];

  const approvedContext = useMemo(() => {
    const context: Record<string, unknown> = { domain: workspace.domain };
    for (const stage of STAGES) {
      const state = workspace.stages[stage.key];
      if (state.status === "approved") context[stage.key] = state.data;
    }
    return context;
  }, [workspace]);

  function resetAll() {
    setWorkspace(initialState());
    setError("");
    setCopied(false);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function resetFrom(index: number, state: WorkspaceState) {
    const next = { ...state, stages: { ...state.stages } };
    for (let i = index + 1; i < STAGES.length; i += 1) {
      next.stages[STAGES[i].key] = emptyStage();
    }
    return next;
  }

  function editStage(stage: StageKey, text: string) {
    const index = STAGES.findIndex((item) => item.key === stage);
    setWorkspace((current) => {
      const next = resetFrom(index, current);
      next.stages[stage] = { ...next.stages[stage], text, status: "draft" };
      return next;
    });
    setError("");
  }

  function changeDomain(domain: string) {
    setWorkspace((current) => {
      const normalizedCurrent = current.domain.trim().toLowerCase();
      const normalizedNext = domain.trim().toLowerCase();
      if (normalizedCurrent === normalizedNext || !current.domain) return { ...current, domain };
      return { ...initialState(), domain };
    });
    setError("");
  }

  async function runStage(stage: StageKey) {
    if (stage === "human") return;
    if (stage === "company" && !workspace.domain.trim()) {
      setError("Enter a website domain first.");
      return;
    }
    setLoadingStage(stage);
    setError("");
    try {
      const response = await fetch("/api/gtm-research/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          domain: stage === "company" ? workspace.domain : undefined,
          approvedContext: stage === "company" ? undefined : approvedContext,
        }),
      });
      const payload = await response.json() as { result?: unknown; meta?: StageState["meta"]; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error || `Research stage failed with HTTP ${response.status}.`);
      const text = JSON.stringify(payload.result, null, 2);
      const index = STAGES.findIndex((item) => item.key === stage);
      setWorkspace((current) => {
        const next = resetFrom(index, current);
        next.activeStage = stage;
        next.stages[stage] = { status: "draft", text, data: payload.result, meta: payload.meta };
        return next;
      });
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "Research stage failed.");
    } finally {
      setLoadingStage(null);
    }
  }

  function approveStage(stage: StageKey) {
    const index = STAGES.findIndex((item) => item.key === stage);
    const state = workspace.stages[stage];
    let data: unknown;
    if (stage === "human") {
      if (!state.text.trim()) {
        setError("Add your overview/corrections, or write “No changes — use the company research as approved.”");
        return;
      }
      data = { human_overview: state.text.trim() };
    } else {
      try {
        data = JSON.parse(state.text);
      } catch {
        setError("This stage must contain valid JSON before it can be approved.");
        return;
      }
    }

    setWorkspace((current) => {
      const next = resetFrom(index, current);
      next.stages[stage] = { ...next.stages[stage], status: "approved", data, text: state.text };
      const following = STAGES[index + 1];
      if (following) {
        next.activeStage = following.key;
        if (following.key === "human" && !next.stages.human.text) {
          next.stages.human = { ...next.stages.human, status: "draft", text: companyOverview(data) };
        }
      }
      return next;
    });
    setError("");
  }

  function canOpen(index: number) {
    if (index === 0) return true;
    if (workspace.stages[STAGES[index].key].status !== "idle") return true;
    return STAGES.slice(0, index).every((stage) => workspace.stages[stage.key].status === "approved");
  }

  async function copyApproved() {
    await navigator.clipboard.writeText(JSON.stringify(approvedContext, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const allApproved = STAGES.every((stage) => workspace.stages[stage.key].status === "approved");

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <Link href="/" className={styles.back}><ArrowLeft size={15} /> SDR Dashboard</Link>
            <div className={styles.kicker}><Sparkles size={14} /> GTM Strategy Workspace</div>
            <h1>Research → approve → build the next stage.</h1>
            <p>Every downstream recommendation uses the latest approved state, including your manual corrections.</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} onClick={copyApproved} disabled={!workspace.domain}>
              <Clipboard size={15} /> {copied ? "Copied" : "Copy approved JSON"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={resetAll}><RotateCcw size={15} /> New project</button>
          </div>
        </header>

        <section className={styles.domainCard}>
          <div className={styles.domainIcon}><Globe2 size={20} /></div>
          <div className={styles.domainField}>
            <label htmlFor="gtm-domain">Website domain</label>
            <input
              id="gtm-domain"
              value={workspace.domain}
              onChange={(event) => changeDomain(event.target.value)}
              placeholder="talentera.com"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => runStage("company")}
            disabled={loadingStage !== null || !workspace.domain.trim()}
          >
            {loadingStage === "company" ? <LoaderCircle className={styles.spin} size={17} /> : <Sparkles size={17} />}
            {workspace.stages.company.status === "idle" ? "Research company" : "Re-run research"}
          </button>
        </section>

        <div className={styles.workspace}>
          <aside className={styles.rail}>
            <div className={styles.railTitle}>Workflow</div>
            {STAGES.map((stage, index) => {
              const state = workspace.stages[stage.key];
              const enabled = canOpen(index);
              return (
                <button
                  type="button"
                  key={stage.key}
                  className={`${styles.stageButton} ${workspace.activeStage === stage.key ? styles.stageButtonActive : ""}`}
                  onClick={() => enabled && setWorkspace((current) => ({ ...current, activeStage: stage.key }))}
                  disabled={!enabled}
                >
                  <span className={`${styles.stageIndex} ${state.status === "approved" ? styles.stageIndexApproved : ""}`}>
                    {state.status === "approved" ? <Check size={13} /> : stage.eyebrow}
                  </span>
                  <span className={styles.stageText}>
                    <strong>{stage.label}</strong>
                    <small>{state.status === "approved" ? "Approved" : state.status === "draft" ? "Needs review" : "Locked"}</small>
                  </span>
                  {enabled ? <ChevronRight size={15} /> : <LockKeyhole size={13} />}
                </button>
              );
            })}
          </aside>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelEyebrow}>STEP {activeDefinition.eyebrow}</div>
                <h2>{activeDefinition.label}</h2>
                <p>{activeDefinition.description}</p>
              </div>
              <span className={`${styles.status} ${activeState.status === "approved" ? styles.statusApproved : activeState.status === "draft" ? styles.statusDraft : ""}`}>
                {activeState.status}
              </span>
            </div>

            {activeDefinition.key === "company" && activeState.status === "idle" ? (
              <div className={styles.emptyState}>
                <Globe2 size={28} />
                <strong>Start with a public company website.</strong>
                <span>The server will inspect the homepage and relevant company/product pages before asking the local AI model to structure the research.</span>
              </div>
            ) : activeDefinition.key === "human" ? (
              <div className={styles.editorBlock}>
                <div className={styles.callout}>
                  <strong>This is your source-of-truth checkpoint.</strong>
                  <span>Correct markets, positioning, customer type, exclusions, or anything else. Later stages will receive this approved text.</span>
                </div>
                <label htmlFor="human-overview">Human overview / corrections</label>
                <textarea
                  id="human-overview"
                  className={`${styles.editor} ${styles.humanEditor}`}
                  value={activeState.text}
                  onChange={(event) => editStage("human", event.target.value)}
                  placeholder="Example: Talentera is primarily focused on Saudi Arabia, UAE and MENA enterprise HR teams. Do not position the USA as a primary market."
                />
              </div>
            ) : activeState.status === "idle" ? (
              <div className={styles.emptyState}>
                <LockKeyhole size={26} />
                <strong>Ready to generate from approved context.</strong>
                <span>No earlier draft will leak into this stage. Only approved inputs are sent to the model.</span>
                <button type="button" className={styles.primaryButton} onClick={() => runStage(activeDefinition.key)} disabled={loadingStage !== null}>
                  {loadingStage === activeDefinition.key ? <LoaderCircle className={styles.spin} size={17} /> : <Sparkles size={17} />}
                  Generate {activeDefinition.label}
                </button>
              </div>
            ) : (
              <div className={styles.editorBlock}>
                {activeState.meta?.warning ? <div className={styles.warning}>{activeState.meta.warning}</div> : null}
                <div className={styles.editorMeta}>
                  <span>{activeState.meta?.ai === "ollama" ? `Local AI · ${activeState.meta.model || "Ollama"}` : activeState.meta?.ai === "fallback" ? "Deterministic fallback" : "Editable structured output"}</span>
                  {activeState.meta?.sources?.length ? <span>{activeState.meta.sources.length} website source(s)</span> : null}
                </div>
                <label htmlFor="stage-editor">Editable JSON</label>
                <textarea
                  id="stage-editor"
                  className={styles.editor}
                  value={activeState.text}
                  onChange={(event) => editStage(activeDefinition.key, event.target.value)}
                  spellCheck={false}
                />
                {activeState.meta?.sources?.length ? (
                  <details className={styles.sources}>
                    <summary>Research sources</summary>
                    {activeState.meta.sources.map((source) => <div key={source}>{source}</div>)}
                  </details>
                ) : null}
              </div>
            )}

            {error ? <div className={styles.error}>{error}</div> : null}

            {(activeDefinition.key === "human" || activeState.status !== "idle") ? (
              <div className={styles.footerActions}>
                {activeDefinition.key !== "human" ? (
                  <button type="button" className={styles.secondaryButton} onClick={() => runStage(activeDefinition.key)} disabled={loadingStage !== null}>
                    {loadingStage === activeDefinition.key ? <LoaderCircle className={styles.spin} size={16} /> : <RefreshCw size={16} />}
                    Regenerate using approved inputs
                  </button>
                ) : <span className={styles.savedHint}><Save size={14} /> Draft saved in this browser</span>}
                <button type="button" className={styles.approveButton} onClick={() => approveStage(activeDefinition.key)} disabled={!activeState.text.trim() || loadingStage !== null}>
                  <Check size={16} /> Approve & continue
                </button>
              </div>
            ) : null}
          </section>
        </div>

        {allApproved ? (
          <section className={styles.completeCard}>
            <div><Check size={20} /><strong>GTM strategy workflow approved.</strong></div>
            <span>You now have one consistent approved context from company research through outreach channels.</span>
          </section>
        ) : null}
      </div>
    </main>
  );
}
