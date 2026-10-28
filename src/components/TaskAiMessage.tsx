"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import type { OutreachDraft } from "@/lib/task-outreach";
import styles from "./TaskAiMessage.module.css";

type Payload = { draft: OutreachDraft; brand: string; cached: boolean; evidence: { company: string; title: string } };
export function TaskAiMessage({ contactId, contactName }: { contactId: string; contactName?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  async function generate() {
    if (loading) return;
    setOpen(true);
    if (result) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ai/task-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId }), signal: AbortSignal.timeout(40_000) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft) throw new Error(payload?.error || `Message generation unavailable (HTTP ${response.status})`);
      setResult(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to generate message. Please retry.");
    } finally { setLoading(false); }
  }
  function close() { dialog.current?.close(); setOpen(false); trigger.current?.focus(); }
  async function copy(key: keyof OutreachDraft) {
    if (!result) return;
    try { await navigator.clipboard.writeText(result.draft[key]); setCopyStatus("Copied"); }
    catch { setCopyStatus("Copy unavailable. Select the text and copy manually."); }
  }
  return <>
    <button ref={trigger} type="button" className={styles.trigger} onClick={() => void generate()} aria-label={`Generate AI message for ${contactName || "contact"}`}><Sparkles size={13} aria-hidden="true"/>AI Message</button>
    {open && createPortal(<dialog ref={dialog} className={styles.dialog} aria-label="Saudi Arabic AI messages" onCancel={event => { event.preventDefault(); close(); }}>
      <div className={styles.header}><strong>AI Message · {contactName || "Contact"}</strong><button type="button" onClick={close} autoFocus>Close</button></div>
      <p>Saudi Arabic · Review before sending · No message is sent automatically</p>
      {loading && <p role="status">Preparing hook and LinkedIn messages…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={() => void generate()}>Retry</button></div>}
      {result && <>
        <p>{result.brand} · {result.evidence.company} · {result.evidence.title}{result.cached ? " · Saved draft" : ""}</p>
        {([ ["hook", "Hook", 180], ["connection", "LinkedIn connection note", 200], ["message", "Message after acceptance", 500] ] as const).map(([key, label, max]) => <div key={key} className={styles.field}>
          <label htmlFor={`draft-${contactId}-${key}`}>{label}</label>
          <textarea id={`draft-${contactId}-${key}`} lang="ar-SA" dir="auto" rows={key === "message" ? 4 : 3} maxLength={max} value={result.draft[key]} onChange={event => { setResult({ ...result, draft: { ...result.draft, [key]: event.target.value } }); setCopyStatus(""); }}/>
          <div className={styles.footer}><span>{result.draft[key].length}/{max}</span><button type="button" onClick={() => void copy(key)}>Copy {label}</button></div>
        </div>)}
        <p role="status" aria-live="polite">{copyStatus}</p>
      </>}
    </dialog>, document.body)}
  </>;
}
