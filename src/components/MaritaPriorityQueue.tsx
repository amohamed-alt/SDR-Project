"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Building2, CalendarClock, CheckSquare2, CircleAlert, ExternalLink, Flame,
  Mail, Phone, RefreshCw, Search, Square, Target, UsersRound,
} from "lucide-react";
import styles from "@/components/MaritaPriorityQueue.module.css";
import type { MaritaPriorityCompany, MaritaPriorityPayload, MaritaPriorityTier } from "@/lib/marita-priority";

const today = new Date().toISOString().slice(0, 10);
type PriorityFilter = "all" | MaritaPriorityTier;
type QuickView = "best" | "all" | "noats" | "never" | "noanswer" | "tiera" | "ksa" | "uae" | "needsphone";

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

function priorityText(tier: MaritaPriorityTier) {
  if (tier === "P1") return "P1 · Call first";
  if (tier === "P2") return "P2 · High";
  if (tier === "P3") return "P3 · Next";
  return "P4 · Needs data";
}

function countryMatches(country: string, target: "ksa" | "uae") {
  const value = country.toLowerCase();
  return target === "ksa"
    ? /saudi|ksa/.test(value)
    : /united arab emirates|\buae\b|dubai|abu dhabi/.test(value);
}

function quickViewMatches(company: MaritaPriorityCompany, view: QuickView) {
  if (view === "all") return true;
  if (view === "best") return company.callableTaskCount > 0;
  if (view === "noats") return company.noAts;
  if (view === "never") return company.neverAttempted;
  if (view === "noanswer") return company.noAnswerCount > 0;
  if (view === "tiera") return company.companyTier === "A";
  if (view === "ksa") return countryMatches(company.country, "ksa");
  if (view === "uae") return countryMatches(company.country, "uae");
  return company.callableTaskCount === 0;
}

export function MaritaPriorityQueue({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<MaritaPriorityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [quickView, setQuickView] = useState<QuickView>("best");
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
      if (!quickViewMatches(company, quickView)) return false;
      if (!term) return true;
      const contactText = company.contacts.flatMap((contact) => [contact.contactName, contact.contactTitle, contact.email, contact.phone]);
      return [
        company.companyName, company.domain, company.country, company.companyTier, company.icpTier,
        company.detectedAts, company.contactName, company.contactTitle, company.email, company.phone, ...contactText,
      ].some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [data, priority, quickView, search]);

  const pageSize = 75;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectableVisible = visible.filter((company) => company.callableTaskCount > 0);

  const selectedCompanies = useMemo(
    () => (data?.companies ?? []).filter((company) => selected.has(company.companyId) && company.callableTaskCount > 0),
    [data, selected],
  );
  const selectedTaskIds = useMemo(
    () => [...new Set(selectedCompanies.flatMap((company) => company.callableTaskIds))],
    [selectedCompanies],
  );

  function switchView(view: QuickView) {
    setQuickView(view);
    setPage(1);
  }

  function toggle(company: MaritaPriorityCompany) {
    if (!company.callableTaskCount) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(company.companyId)) next.delete(company.companyId);
      else next.add(company.companyId);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = selectableVisible.length > 0 && selectableVisible.every((company) => next.has(company.companyId));
      for (const company of selectableVisible) {
        if (allSelected) next.delete(company.companyId);
        else next.add(company.companyId);
      }
      return next;
    });
  }

  async function reschedule() {
    if (!selectedTaskIds.length) return;
    const confirmed = window.confirm(
      `Move ${selectedTaskIds.length} callable Extensive-Lighter task(s) across ${selectedCompanies.length} companies to ${dueDate} at ${dueTime} Riyadh time? The server will re-check phone, connected-call and deal exclusions before updating.`,
    );
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
      setMessage(`Updated ${payload.updated} task(s). ${payload.skipped ? `${payload.skipped} skipped by the safety re-check.` : ""}`);
      setSelected(new Set());
      await load(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update task due dates");
    } finally {
      setSaving(false);
    }
  }

  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((company) => selected.has(company.companyId));
  const connectedPercent = data?.summary.portfolioCompanies
    ? Math.round((data.summary.connectedCompanies / data.summary.portfolioCompanies) * 100)
    : 0;

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16}/>SDR Dashboard</button>
      <div className={styles.title}>
        <span><Phone size={15}/>MARITA PRIORITY QUEUE</span>
        <h1>Who should Marita call next?</h1>
        <p>Extensive-Lighter call tasks only. No Connected call, no Retention, no Closed Won, and no open deal.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void load(true)} disabled={loading}>
        <RefreshCw size={15} className={loading ? styles.spin : ""}/>{loading ? "Refreshing" : "Refresh"}
      </button>
    </header>

    {error && <div className={styles.error}><CircleAlert size={15}/>{error}</div>}
    {message && <div className={styles.success}>{message}</div>}

    <section className={styles.metrics}>
      <article><UsersRound size={18}/><span>SDR portfolio contacts</span><strong>{data?.summary.portfolioContacts.toLocaleString() ?? "—"}</strong></article>
      <article><Building2 size={18}/><span>Portfolio companies</span><strong>{data?.summary.portfolioCompanies.toLocaleString() ?? "—"}</strong></article>
      <article><Target size={18}/><span>Companies connected</span><strong>{data?.summary.connectedCompanies.toLocaleString() ?? "—"}</strong></article>
      <article><Phone size={18}/><span>No Connected call</span><strong>{data?.summary.noConnectedCompanies.toLocaleString() ?? "—"}</strong></article>
      <article><CheckSquare2 size={18}/><span>Ready to call</span><strong>{data?.summary.readyToCallCompanies.toLocaleString() ?? "—"}</strong></article>
      <article className={styles.hotMetric}><Flame size={18}/><span>High priority</span><strong>{data?.summary.highPriorityCompanies.toLocaleString() ?? "—"}</strong></article>
    </section>

    <section className={styles.coverageStrip}>
      <div><strong>Connected coverage</strong><span>{connectedPercent}% of Marita&apos;s company portfolio has at least one Connected call.</span></div>
      <div className={styles.coverageTrack}><i style={{ width: `${connectedPercent}%` }}/></div>
      <div className={styles.miniStats}>
        <span><b>{data?.summary.extensiveLighterCompanies.toLocaleString() ?? "—"}</b> with Extensive-Lighter tasks</span>
        <span><b>{data?.summary.openExtensiveTasks.toLocaleString() ?? "—"}</b> open tasks</span>
        <span><b>{data?.summary.noAts.toLocaleString() ?? "—"}</b> no ATS</span>
        <span><b>{data?.summary.excludedDeals.toLocaleString() ?? "—"}</b> excluded by deal</span>
        <span><b>{data?.summary.excludedRetention.toLocaleString() ?? "—"}</b> retention</span>
      </div>
    </section>

    <section className={styles.quickViews}>
      <button type="button" data-active={quickView === "best"} onClick={() => switchView("best")}>📞 Ready to call</button>
      <button type="button" data-active={quickView === "never"} onClick={() => switchView("never")}>✨ Never attempted</button>
      <button type="button" data-active={quickView === "noanswer"} onClick={() => switchView("noanswer")}>☎️ No answer</button>
      <button type="button" data-active={quickView === "noats"} onClick={() => switchView("noats")}>🚫 No ATS</button>
      <button type="button" data-active={quickView === "tiera"} onClick={() => switchView("tiera")}>A Tier A</button>
      <button type="button" data-active={quickView === "ksa"} onClick={() => switchView("ksa")}>🇸🇦 KSA</button>
      <button type="button" data-active={quickView === "uae"} onClick={() => switchView("uae")}>🇦🇪 UAE</button>
      <button type="button" data-active={quickView === "needsphone"} onClick={() => switchView("needsphone")}>⚠️ Needs phone</button>
      <button type="button" data-active={quickView === "all"} onClick={() => switchView("all")}>All eligible</button>
    </section>

    <section className={styles.controls}>
      <label className={styles.search}><Search size={15}/><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search company, contact, phone, country, ATS…"/></label>
      <select value={priority} onChange={(event) => { setPriority(event.target.value as PriorityFilter); setPage(1); }}>
        <option value="all">All priority levels</option>
        <option value="P1">P1 · Call first</option><option value="P2">P2 · High</option><option value="P3">P3 · Next</option><option value="P4">P4 · Needs data</option>
      </select>
    </section>

    <section className={styles.bulkBar}>
      <button type="button" className={styles.selectButton} onClick={selectVisible} disabled={!selectableVisible.length}>
        {allVisibleSelected ? <CheckSquare2 size={15}/> : <Square size={15}/>} {allVisibleSelected ? "Unselect page" : "Select callable page"}
      </button>
      <div className={styles.selectionCount}><strong>{selectedCompanies.length}</strong><span>companies</span><small>{selectedTaskIds.length} callable tasks</small></div>
      <label><span>New due date</span><input type="date" value={dueDate} min={today} onChange={(event) => setDueDate(event.target.value)}/></label>
      <label><span>Time · Riyadh</span><input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)}/></label>
      <button type="button" className={styles.moveButton} disabled={!selectedTaskIds.length || saving} onClick={() => void reschedule()}>
        <CalendarClock size={15}/>{saving ? "Safety checking…" : "Move selected tasks"}
      </button>
    </section>

    <section className={styles.tablePanel}>
      <div className={styles.tableHeader}>
        <div><h2>Priority queue</h2><p>No Answer stays eligible. A company leaves this queue only after a Connected call or a commercial exclusion.</p></div>
        <span>{filtered.length.toLocaleString()} matching companies</span>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th/><th>Priority</th><th>Company</th><th>Best contact</th><th>Touch status</th><th>ATS</th><th>Contacts / tasks</th><th>Due</th><th/></tr></thead>
          <tbody>
            {visible.map((company) => <tr key={company.companyId} className={selected.has(company.companyId) ? styles.selectedRow : ""}>
              <td><button className={styles.checkbox} type="button" disabled={!company.callableTaskCount} onClick={() => toggle(company)} aria-label={`Select ${company.companyName}`}>
                {selected.has(company.companyId) ? <CheckSquare2 size={17}/> : <Square size={17}/>}</button></td>
              <td>
                <span className={styles.priority} data-tier={company.priority}>{priorityText(company.priority)}</span>
                <strong className={styles.score}>{company.priorityScore}/100</strong>
                <div className={styles.reasonTags}>{company.priorityReasons.slice(0, 3).map((reason) => <i key={reason}>{reason}</i>)}</div>
              </td>
              <td>
                <strong>{company.companyName}</strong>
                <div className={styles.companyBadges}>
                  {company.companyTier && <i>Tier {company.companyTier}</i>}
                  {company.country && <i>{company.country}</i>}
                  {company.noAts && <i className={styles.warningBadge}>No ATS</i>}
                </div>
                <small>{company.domain || "No domain"}</small>
              </td>
              <td>
                <a href={company.contactUrl} target="_blank" rel="noreferrer">{company.contactName}<ExternalLink size={11}/></a>
                <span>{company.contactTitle || "—"}</span>
                {company.phone ? <strong className={styles.phone}>{company.phone}</strong> : <span className={styles.muted}>No phone</span>}
                {company.email && <small><Mail size={11}/>{company.email}</small>}
              </td>
              <td>
                {company.neverAttempted
                  ? <span className={styles.newTouch}>New · never attempted</span>
                  : <><strong>{company.attemptCount} attempt{company.attemptCount === 1 ? "" : "s"} · no connect</strong>{company.noAnswerCount > 0 && <span>No answer ×{company.noAnswerCount}</span>}<small>Last: {formatDate(company.lastAttemptAt)}</small></>}
              </td>
              <td>{company.noAts ? <span className={styles.noAts}>No reliable ATS</span> : <><strong>{company.detectedAts || "Detected"}</strong><small>{company.atsStatus}</small></>}</td>
              <td>
                <details className={styles.contactDetails}>
                  <summary>{company.contactCount} contact{company.contactCount === 1 ? "" : "s"} · {company.taskCount} task{company.taskCount === 1 ? "" : "s"}</summary>
                  <div>{company.contacts.map((contact) => <article key={contact.contactId}>
                    <a href={contact.contactUrl} target="_blank" rel="noreferrer">{contact.contactName}</a>
                    <span>{contact.contactTitle || "—"}</span>
                    <small>{contact.phone || "No phone"}{contact.email ? ` · ${contact.email}` : ""}</small>
                    <b>{contact.taskCount} task{contact.taskCount === 1 ? "" : "s"} · {formatDate(contact.dueAt)}</b>
                  </article>)}</div>
                </details>
                <small>{company.callableTaskCount} callable task{company.callableTaskCount === 1 ? "" : "s"}</small>
              </td>
              <td><strong className={company.overdue ? styles.overdue : ""}>{formatDate(company.dueAt)}</strong><small>{company.primaryTaskSubject || "Extensive-Lighter call task"}</small></td>
              <td><a className={styles.companyLink} href={company.companyUrl} target="_blank" rel="noreferrer"><Building2 size={14}/>HubSpot</a></td>
            </tr>)}
            {!loading && !visible.length && <tr><td colSpan={9} className={styles.empty}>No companies match this view.</td></tr>}
            {loading && !data && <tr><td colSpan={9} className={styles.empty}>Building Marita&apos;s company priority queue from HubSpot…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className={styles.pagination}><span>Page {safePage} / {pages}</span><div><button type="button" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}>Previous</button><button type="button" disabled={safePage >= pages} onClick={() => setPage(Math.min(pages, safePage + 1))}>Next</button></div></div>
    </section>
  </main>;
}
