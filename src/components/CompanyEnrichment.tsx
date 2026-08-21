"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import styles from "@/components/CompanyEnrichment.module.css";

type Repair = {
  property: string;
  currentValue: string;
  suggestedValue: string;
  disposition: "same" | "fill" | "conflict" | "missing_property" | "no_suggestion";
  confidence: number;
  evidence: string;
  canAutoApply: boolean;
};

type Analysis = {
  domain: string;
  found: boolean;
  company: { id: string; name: string; hubspotUrl: string };
  intelligence: {
    status: string;
    confidence: number;
    careerPageUrl: string;
    detectedAts: string;
    atsConfidence: string;
    evidenceUrl: string;
    evidenceReason: string;
    detectionMethod: string;
    playwrightUsed: boolean;
    durationMs: number;
  };
  repairs: Repair[];
  summary: { fills: number; conflicts: number; unchanged: number; autoApplicable: number };
};

type AnalyzeResponse = { analysis?: Analysis; error?: string };
type PushResponse = { pushed?: string[]; skippedConflicts?: string[]; analysis?: Analysis; error?: string };

function valueClass(value: string) {
  return value ? styles.value : `${styles.value} ${styles.empty}`;
}

export function CompanyEnrichment() {
  const [domain, setDomain] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [overwriteConflicts, setOverwriteConflicts] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function analyze(event?: FormEvent, preserveSuccess = false) {
    event?.preventDefault();
    if (!domain.trim() || loading) return;
    setLoading(true);
    setError("");
    if (!preserveSuccess) setSuccess("");
    try {
      const response = await fetch("/api/company-enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze", domain, forceRefresh: true }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as AnalyzeResponse;
      if (!response.ok || !body.analysis) throw new Error(body.error || `Analysis failed (${response.status})`);
      setAnalysis(body.analysis);
    } catch (analysisError) {
      setAnalysis(null);
      setError(analysisError instanceof Error ? analysisError.message : "Company enrichment failed.");
    } finally {
      setLoading(false);
    }
  }

  async function pushRepairs() {
    if (!analysis || pushing) return;
    setPushing(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/company-enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push", domain: analysis.domain, overwriteConflicts }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as PushResponse;
      if (!response.ok) throw new Error(body.error || `HubSpot push failed (${response.status})`);
      const pushed = body.pushed || [];
      const skipped = body.skippedConflicts || [];
      let message = pushed.length ? `Updated ${pushed.length} HubSpot properties: ${pushed.join(", ")}.` : "No safe HubSpot changes were needed.";
      if (skipped.length) message += ` ${skipped.length} conflict(s) were left untouched.`;
      setSuccess(message);
      await analyze(undefined, true);
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "Unable to push repairs to HubSpot.");
    } finally {
      setPushing(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <section className={styles.hero}>
          <Link className={styles.back} href="/"><ArrowLeft size={15}/> Dashboard</Link>
          <div className={styles.eyebrow}>COMPANY ENRICHMENT · HUBSPOT REPAIR ENGINE</div>
          <h1>Domain → evidence → clean HubSpot</h1>
          <p>Enter a company domain. The engine re-reads the HubSpot company, verifies Career Page and ATS through the existing self-hosted intelligence engine, shows exactly what is missing or conflicting, and only writes evidence-backed fields.</p>
        </section>

        <section className={styles.searchCard}>
          <form className={styles.form} onSubmit={analyze}>
            <input className={styles.input} value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="company.com or https://company.com" autoCapitalize="none" autoCorrect="off"/>
            <button className={styles.primary} type="submit" disabled={loading || !domain.trim()}>{loading ? <RefreshCw className={styles.spin} size={16}/> : <ShieldCheck size={16}/>} {loading ? "Verifying…" : "Analyze HubSpot properties"}</button>
          </form>
          <div className={styles.hint}>Safe mode fills verified blanks automatically. Different existing HubSpot values are treated as conflicts and require explicit overwrite.</div>
        </section>

        {error ? <div className={`${styles.message} ${styles.error}`}><AlertTriangle size={16}/>{error}</div> : null}
        {success ? <div className={`${styles.message} ${styles.success}`}><CheckCircle2 size={16}/>{success}</div> : null}

        {analysis ? (
          <>
            <section className={styles.companyCard}>
              <div>
                <h2>{analysis.company.name}</h2>
                <p>{analysis.domain} · {analysis.intelligence.status || "Intelligence completed"} · {analysis.intelligence.detectionMethod || "verified crawl"}</p>
                <a href={analysis.company.hubspotUrl} target="_blank" rel="noreferrer">Open HubSpot company <ExternalLink size={11}/></a>
              </div>
              <div className={styles.metrics}>
                <div className={styles.metric}><span>Confidence</span><strong>{analysis.intelligence.confidence}</strong></div>
                <div className={styles.metric}><span>Fill</span><strong>{analysis.summary.fills}</strong></div>
                <div className={styles.metric}><span>Conflicts</span><strong>{analysis.summary.conflicts}</strong></div>
                <div className={styles.metric}><span>ATS</span><strong>{analysis.intelligence.detectedAts || "—"}</strong></div>
              </div>
            </section>

            <section className={styles.repairsCard}>
              <div className={styles.header}>
                <div><h3>Property repair plan</h3><p>Current HubSpot value vs verified suggestion. Every push is re-analyzed before write and appended to an audit log.</p></div>
                <div className={styles.controls}>
                  <label className={styles.toggle}><input type="checkbox" checked={overwriteConflicts} onChange={(event) => setOverwriteConflicts(event.target.checked)}/> Allow 95%+ evidence-backed conflict overwrite</label>
                  <button className={styles.pushButton} type="button" onClick={() => void pushRepairs()} disabled={pushing}>{pushing ? <RefreshCw className={styles.spin} size={15}/> : <UploadCloud size={15}/>} {pushing ? "Pushing…" : "Push approved repairs"}</button>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Property</th><th>Status</th><th>Current HubSpot</th><th>Verified suggestion</th><th>Confidence</th><th>Evidence</th></tr></thead>
                  <tbody>{analysis.repairs.map((repair) => (
                    <tr key={repair.property}>
                      <td className={styles.property}>{repair.property}</td>
                      <td><span className={`${styles.badge} ${styles[repair.disposition]}`}>{repair.disposition.replace(/_/g, " ")}</span></td>
                      <td className={valueClass(repair.currentValue)}>{repair.currentValue || "Empty"}</td>
                      <td className={valueClass(repair.suggestedValue)}>{repair.suggestedValue || "No verified suggestion"}</td>
                      <td>{repair.confidence}%{repair.canAutoApply ? " · auto" : ""}</td>
                      <td className={styles.evidence}>{repair.evidence || "No evidence supplied"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}