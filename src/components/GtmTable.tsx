"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Download, Search } from "lucide-react";

export type GtmColumn<T> = ColumnDef<T, unknown>;

type ExportValue = string | number | boolean | null | undefined;

type GtmTableProps<T> = {
  rows: T[];
  columns: GtmColumn<T>[];
  getRowId: (row: T) => string;
  getSearchText: (row: T) => string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  exportFileName?: string;
  exportRow?: (row: T) => Record<string, ExportValue>;
};

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv<T>(fileName: string, rows: T[], exportRow: NonNullable<GtmTableProps<T>["exportRow"]>) {
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

export function GtmTable<T>({
  rows,
  columns,
  getRowId,
  getSearchText,
  pageSize = 50,
  emptyTitle = "No matching records",
  emptyDescription = "Try a different search inside this result set.",
  exportFileName = "gtm-records.csv",
  exportRow,
}: GtmTableProps<T>) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const tableColumns = useMemo(() => columns, [columns]);
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getRowId: (row) => getRowId(row),
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    globalFilterFn: (row, _columnId, value) => {
      const term = String(value ?? "").trim().toLowerCase();
      return !term || getSearchText(row.original).toLowerCase().includes(term);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const exportRows = table.getPrePaginationRowModel().rows.map((row) => row.original);
  const pageCount = Math.max(1, table.getPageCount());
  const pageIndex = table.getState().pagination.pageIndex;

  return <div className="gtm-table-surface">
    <div className="gtm-data-toolbar">
      <label className="gtm-data-search"><Search size={15}/><input value={globalFilter} onChange={(event) => { setGlobalFilter(event.target.value); table.setPageIndex(0); }} placeholder="Search these records…" aria-label="Search records"/></label>
      <label className="gtm-page-size"><span>Rows</span><select value={table.getState().pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      <div className="gtm-data-count"><strong>{filteredCount}</strong><span>{globalFilter ? `matching of ${rows.length}` : "records"}</span></div>
      {exportRow ? <button className="gtm-data-export" type="button" disabled={!exportRows.length} onClick={() => downloadCsv(exportFileName, exportRows, exportRow)}><Download size={14}/><span>CSV</span></button> : null}
    </div>

    <div className="gtm-table-scroll">
      <table className="gtm-table">
        <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
          const sorted = header.column.getIsSorted();
          return <th key={header.id} style={{ width: header.getSize() }} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
            {header.isPlaceholder ? null : header.column.getCanSort()
              ? <button type="button" className="gtm-sort-header" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{sorted === "asc" ? <ChevronUp size={12}/> : sorted === "desc" ? <ChevronDown size={12}/> : <ChevronsUpDown size={12}/>}</button>
              : flexRender(header.column.columnDef.header, header.getContext())}
          </th>;
        })}</tr>)}</thead>
        <tbody>
          {table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}
        </tbody>
      </table>
      {!filteredCount ? <div className="gtm-data-empty"><Search size={26}/><strong>{emptyTitle}</strong><span>{emptyDescription}</span></div> : null}
    </div>

    {filteredCount ? <div className="gtm-table-footer"><span>Page <strong>{pageIndex + 1}</strong> of <strong>{pageCount}</strong></span><div><button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft size={14}/>Previous</button><button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next<ChevronRight size={14}/></button></div></div> : null}
  </div>;
}
