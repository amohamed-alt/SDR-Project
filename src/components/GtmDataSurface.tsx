"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownAZ, Download, Search } from "lucide-react";

export type GtmSortOption<T> = {
  id: string;
  label: string;
  compare: (left: T, right: T) => number;
};

type GtmDataSurfaceProps<T> = {
  rows: T[];
  getKey: (row: T) => string;
  getSearchText: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  sortOptions?: GtmSortOption<T>[];
  defaultSortId?: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  exportFileName?: string;
  exportRow?: (row: T) => Record<string, string | number | boolean | null | undefined>;
};

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv<T>(fileName: string, rows: T[], exportRow: NonNullable<GtmDataSurfaceProps<T>["exportRow"]>) {
  if (!rows.length) return;
  const mapped = rows.map(exportRow);
  const headers = Array.from(new Set(mapped.flatMap((row) => Object.keys(row))));
  const csv = [
    headers.map(csvCell).join(","),
    ...mapped.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function GtmDataSurface<T>({
  rows,
  getKey,
  getSearchText,
  renderRow,
  sortOptions = [],
  defaultSortId,
  pageSize = 50,
  emptyTitle = "No matching records",
  emptyDescription = "Try a different search inside this result set.",
  exportFileName = "gtm-records.csv",
  exportRow,
}: GtmDataSurfaceProps<T>) {
  const [query, setQuery] = useState("");
  const [sortId, setSortId] = useState(defaultSortId ?? sortOptions[0]?.id ?? "");
  const [limit, setLimit] = useState(pageSize);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const next = term ? rows.filter((row) => getSearchText(row).toLowerCase().includes(term)) : [...rows];
    const sort = sortOptions.find((option) => option.id === sortId);
    if (sort) next.sort(sort.compare);
    return next;
  }, [getSearchText, query, rows, sortId, sortOptions]);

  const visible = filtered.slice(0, limit);

  return <div className="gtm-data-surface">
    <div className="gtm-data-toolbar">
      <label className="gtm-data-search"><Search size={15}/><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(pageSize); }} placeholder="Search these records…" aria-label="Search records"/></label>
      {sortOptions.length ? <label className="gtm-data-sort"><ArrowDownAZ size={14}/><span>Sort</span><select value={sortId} onChange={(event) => { setSortId(event.target.value); setLimit(pageSize); }}>{sortOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
      <div className="gtm-data-count"><strong>{filtered.length}</strong><span>{query ? `matching of ${rows.length}` : "records"}</span></div>
      {exportRow ? <button className="gtm-data-export" type="button" disabled={!filtered.length} onClick={() => downloadCsv(exportFileName, filtered, exportRow)}><Download size={14}/><span>CSV</span></button> : null}
    </div>

    <div className="gtm-data-list">
      {!filtered.length ? <div className="gtm-data-empty"><Search size={26}/><strong>{emptyTitle}</strong><span>{emptyDescription}</span></div> : null}
      {visible.map((row) => <div className="gtm-data-row" key={getKey(row)}>{renderRow(row)}</div>)}
      {filtered.length > limit ? <button className="load-more" type="button" onClick={() => setLimit((current) => current + pageSize)}>Show {Math.min(pageSize, filtered.length - limit)} more · {filtered.length - limit} remaining</button> : null}
    </div>
  </div>;
}
