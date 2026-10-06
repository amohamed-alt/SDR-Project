"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Download, Search } from "lucide-react";
import { dashboardRecordColumns } from "./DashboardRecordColumns";
import type { DashboardRecordPage, DashboardRecordSource } from "@/lib/dashboard-records";

const pages = new Map<string, DashboardRecordPage>();

export function DashboardRecordsTable({ source, lazy = false, variant }: { source: DashboardRecordSource; lazy?: boolean; variant?: "priority" | "attribution" | "accounts" }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState("");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [state, setState] = useState<{ key: string; page?: DashboardRecordPage; error?: string; expired?: boolean }>({ key: "" });
  const columns = dashboardRecordColumns(source.selection.kind, variant);
  const params = new URLSearchParams(Object.entries(source.filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
  params.set("version", source.version);
  params.set("selection", JSON.stringify(source.selection));
  params.set("q", query);
  params.set("offset", String(pageIndex * limit));
  params.set("limit", String(limit));
  if (sort) { params.set("sort", sort); params.set("direction", direction); }
  const key = params.toString();
  const page = state.key === key ? state.page : pages.get(key);
  const error = state.key === key ? state.error : undefined;

  useEffect(() => {
    if (!lazy || visible || !container.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: "200px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPageIndex(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    if (pages.has(key)) return;
    async function load() {
      try {
        const response = await fetch(`/api/dashboard/records?${key}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]), cache: "no-store" });
        const result = await response.json();
        if (!response.ok) { if (!controller.signal.aborted) setState({ key, error: result.error || "Unable to load records", expired: response.status === 409 }); return; }
        if (controller.signal.aborted) return;
        pages.set(key, result);
        while (pages.size > 24) pages.delete(pages.keys().next().value!);
        setState({ key, page: result });
      } catch {
        if (!controller.signal.aborted) setState({ key, error: "Unable to load records. Please retry." });
      }
    }
    void load();
    return () => controller.abort();
  }, [key, visible, retry]);

  async function exportCsv() {
    setExporting(true);
    try {
      const exportParams = new URLSearchParams(key);
      exportParams.set("format", "csv");
      const response = await fetch(`/api/dashboard/records?${exportParams}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error((await response.json()).error || "Export failed");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dashboard-${source.selection.kind}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) { setState(current => ({ ...current, key, error: error instanceof Error ? error.message : "Export failed" })); }
    finally { setExporting(false); }
  }

  const totalPages = Math.max(1, Math.ceil((page?.total || 0) / limit));
  return <div ref={container} className="gtm-table-surface" aria-busy={visible && !page && !error}>
    <div className="gtm-data-toolbar">
      <label className="gtm-data-search"><Search size={15}/><input aria-label="Search records" placeholder="Search all matching records…" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <label className="gtm-page-size"><span>Rows</span><select aria-label="Rows" value={limit} onChange={event => { setLimit(Number(event.target.value)); setPageIndex(0); }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <div className="gtm-data-count" aria-live="polite"><strong>{page ? page.total.toLocaleString("en-US") : "—"}</strong><span>{query ? "matching records" : "records"}</span></div>
      <button className="gtm-data-export" type="button" disabled={exporting || !page?.total || Boolean(error)} onClick={() => void exportCsv()}><Download size={14}/>{exporting ? "Exporting…" : "CSV"}</button>
    </div>
    {error ? <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => { if (state.expired) window.location.reload(); else { setState({ key: "" }); setRetry(value => value + 1); } }}>{state.expired ? "Reload dashboard" : "Retry"}</button></div> : null}
    <div className="gtm-table-scroll"><table className="gtm-table"><thead><tr>{columns.map(column => <th key={column.id} style={{ width: column.width }} aria-sort={sort === column.id ? direction === "asc" ? "ascending" : "descending" : "none"}>{column.sortable === false ? column.header : <button className="gtm-sort-header" onClick={() => { setSort(column.id); setDirection(sort === column.id && direction === "asc" ? "desc" : "asc"); setPageIndex(0); }}>{column.header}<ChevronsUpDown size={12}/></button>}</th>)}</tr></thead><tbody>{page?.rows.map(row => <tr key={`${"type" in row ? row.type : source.selection.kind}-${row.id}`}>{columns.map(column => <td key={column.id}>{column.render ? column.render(row) : String(column.accessor(row) ?? "—")}</td>)}</tr>)}</tbody></table></div>
    {!page && !error ? <div className="gtm-data-empty" role="status">{visible ? "Loading matching records…" : "Records load when this section is visible."}</div> : null}
    {page && !page.total ? <div className="gtm-data-empty">No matching records. Try a different search.</div> : null}
    {page?.total ? <div className="gtm-table-footer"><span>Page <strong>{pageIndex + 1}</strong> of <strong>{totalPages}</strong> · Full matching dataset</span><div><button disabled={!pageIndex} onClick={() => setPageIndex(value => value - 1)}><ChevronLeft size={14}/>Previous</button><button disabled={pageIndex + 1 >= totalPages} onClick={() => setPageIndex(value => value + 1)}>Next<ChevronRight size={14}/></button></div></div> : null}
  </div>;
}
