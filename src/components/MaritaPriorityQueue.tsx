"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Building2, CalendarClock, CheckSquare2, CircleAlert, ExternalLink, Mail,
  Phone, RefreshCw, Search, ShieldAlert, Square, UsersRound,
} from "lucide-react";
import styles from "@/components/MaritaPriorityQueue.module.css";
import type { MaritaPriorityCompany, MaritaPriorityPayload, MaritaPriorityTier } from "@/lib/marita-priority";

const today = new Date().toISOString().slice(0, 10);

type PriorityFilter = "all" | MaritaPriorityTier;

function formatDate(value: string) {
  if (!value) return "No due date";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function tierText(tier: MaritaPriorityTier) {
  if (tier === "P1") return "P1 · Best";
  if (tier === "P2") return "P2 · Phone / No ATS";
  if (tier === "P3") return "P3 · Phone + Email";
  return "P4 · Phone";
}

export function MaritaPriorityQueue({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<MaritaPriorityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [noAtsOnly, setNoAtsOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState(today);
  const [dueTime, setDueTime] = useState("09:00");
  const [page, setPage] = useState(1);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/marita-priority${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load priority queue");
      setData(payload as MaritaPriorityPayload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load priority queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.companies ?? []).filter((company) => {
      if (priority !== "all" && company.priority !== priority) return false;
      if (noAtsOnly && !company.noAts) return false;
      if (!term) return true;
      return [company.companyName, company.domain, company.contactName, company.contactTitle, company.email, company.phone, company.detectedAts, company.country]
        .some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [data, noAtsOnly, priority, search]);

  const pageSize = 100;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selectedCompanies = useMemo(() => (data?.companies ?? []).filter((company) => selected.has(company.companyId)), [data, selected]);
  const selectedTaskIds = useMemo(() => [...new Set(selectedCompanies.flatMap((company) => company.taskIds))], [selectedCompanies]);

  function toggle(companyId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = visible.length > 0 && visible.every((company) => next.has(company.companyId));
      for (const company of visible) {
        if (allSelected) next.delete(company.companyId);
        else next.add(company.companyId);
      }
      return next;
    });
  }

  async function reschedule() {
    if (!selectedTaskIds.length) return;
    const confirmed = window.confirm(`Move ${selectedTaskIds.length} open Call task(s) across ${selectedCompanies.length} selected companies to ${dueDate} at ${dueTime} Riyadh time? Only Marita-owned open CALL tasks will be changed.`);
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/marita-priority", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: selectedTaskIds, dueDate, dueTime }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to update task due dates");
      setMessage(`Updated ${payload.updated} task(s). ${payload.skipped ? `${payload.skipped} skipped after safety re-check.` : ""}`);
      setSelected(new Set());
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update task due dates");
    } finally {
      setSaving(false);
    }
  }

  const allVisibleSelected = visible.length > 0 && visible.every((company) => selected.has(company.companyId));

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/>SDR Dashboard</button>
      <div className={styles.title}><span><Phone size={15}/>MARITA TASK PRIORITY</span><h1>Companies never called by Marita</h1><p>Open Marita Call tasks only. Companies disappear once a Marita HubSpot or matched Maqsam outbound call exists.</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""}/>Refresh</button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
    {message && <div className={styles.success}>{message}</div>}

    <section className={styles.metrics}>
      <article><UsersRound size={18}/><span>Never-called companies</span><strong>{data?.summary.totalNeverCalledCompanies ?? "—"}</strong></article>
      <article><ShieldAlert size={18}/><span>No reliable ATS</span><strong>{data?.summary.noAts ?? "—"}</strong></article>
      <article><Mail size={18}/><span>Phone + email</span><strong>{data?.summary.phoneAndEmail ?? "—"}</strong></article>
      <article><Phone size={18}/><span>Phone only</span><strong>{data?.summary.phoneOnly ?? "—"}</strong></article>
      <article><CalendarClock size={18}/><span>Overdue companies</span><strong>{data?.summary.overdueCompanies ?? "—"}</strong></article>
      <article><CheckSquare2 size={18}/><span>Open Call tasks</span><strong>{data?.summary.openTasks ?? "—"}</strong></article>
    </section>

    <section className={styles.controls}>
      <label className={styles.search}><Search size={15}/><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search company, contact, phone, email…"/></label>
      <select value={priority} onChange={(event) => { setPriority(event.target.value as PriorityFilter); setPage(1); }}>
        <option value="all">All priorities</option><option value="P1">P1 · Phone + Email · No ATS</option><option value="P2">P2 · Phone · No ATS</option><option value="P3">P3 · Phone + Email</option><option value="P4">P4 · Phone</option>
      </select>
      <label className={styles.toggle}><input type="checkbox" checked={noAtsOnly} onChange={(event) => { setNoAtsOnly(event.target.checked); setPage(1); }}/><span>No ATS only</span></label>
    </section>

    <section className={styles.bulkBar}>
      <button type="button" className={styles.selectButton} onClick={selectVisible}>{allVisibleSelected ? <CheckSquare2 size={15}/> : <Square size={15}/>} {allVisibleSelected ? "Unselect page" : "Select page"}</button>
      <div><strong>{selectedCompanies.length}</strong><span>companies selected</span><small>{selectedTaskIds.length} open tasks</small></div>
      <label><span>New due date</span><input type="date" value={dueDate} min={today} onChange={(event) => setDueDate(event.target.value)}/></label>
      <label><span>Time · Riyadh</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)}/></label>
      <button type="button" className={styles.moveButton} disabled={!selectedTaskIds.length || saving} onClick={() => void reschedule()}><CalendarClock size={15}/>{saving ? "Updating…" : "Move selected tasks"}</button>
    </section>

    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}><div><h2>Priority queue</h2><p>Default view shows no-ATS companies first. Every row has a phone number and at least one open Marita Call task.</p></div><span>{filtered.length.toLocaleString()} matching companies</span></div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th/><th>Priority</th><th>Company</th><th>Best contact</th><th>Phone</th><th>Email</th><th>ATS</th><th>Task / Due</th><th/></tr></thead>
          <tbody>
            {visible.map((company: MaritaPriorityCompany) => <tr key={company.companyId} className={selected.has(company.companyId) ? styles.selectedRow : ""}>
              <td><button className={styles.checkbox} type="button" onClick={() => toggle(company.companyId)}>{selected.has(company.companyId) ? <CheckSquare2 size={17}/> : <Square size={17}/>}</button></td>
              <td><span className={styles.priority} data-tier={company.priority}>{tierText(company.priority)}</span><small>{company.priorityLabel}</small></td>
              <td><strong>{company.companyName}</strong><span>{company.country || "—"}</span><small>{company.domain || "No domain"}</small></td>
              <td><a href={company.contactUrl} target="_blank" rel="noreferrer">{company.contactName}<ExternalLink size={11}/></a><span>{company.contactTitle || "—"}</span></td>
              <td><strong className={styles.phone}>{company.phone}</strong></td>
              <td>{company.email ? <span>{company.email}</span> : <span className={styles.muted}>No email</span>}</td>
              <td>{company.noAts ? <span className={styles.noAts}>No reliable ATS</span> : <span>{company.detectedAts}</span>}</td>
              <td><strong>{company.primaryTaskSubject || "Call task"}</strong><span className={company.overdue ? styles.overdue : ""}>{formatDate(company.dueAt)}</span><small>{company.taskCount} open task{company.taskCount === 1 ? "" : "s"}</small></td>
              <td><a className={styles.companyLink} href={company.companyUrl} target="_blank" rel="noreferrer"><Building2 size={14}/>HubSpot</a></td>
            </tr>)}
            {!loading && !visible.length && <tr><td colSpan={9} className={styles.empty}>No companies match this view.</td></tr>}
            {loading && !data && <tr><td colSpan={9} className={styles.empty}>Building the never-called queue from HubSpot + Maqsam…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={styles.pagination}><span>Page {safePage} / {pages}</span><div><button type="button" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}>Previous</button><button type="button" disabled={safePage >= pages} onClick={() => setPage(Math.min(pages, safePage + 1))}>Next</button></div></div>
    </section>
  </main>;
}
