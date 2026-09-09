"use client";

import { useMemo, type ReactNode } from "react";
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type FilterFn,
  type RowData,
} from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Download, Search } from "lucide-react";

const gtmTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

export type GtmColumn<T extends RowData> = {
  id: string;
  header: string;
  accessor: (row: T) => string | number | boolean | null | undefined;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: number;
};

type ExportValue = string | number | boolean | null | undefined;

type GtmTableProps<T extends RowData> = {
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

function downloadCsv<T extends RowData>(fileName: string, rows: T[], exportRow: NonNullable<GtmTableProps<T>["exportRow"]>) {
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

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function GtmTable<T extends RowData>({
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
  const widths = useMemo(() => new Map(columns.map((column) => [column.id, column.width])), [columns]);
  const tableColumns = useMemo<Array<ColumnDef<typeof gtmTableFeatures, T>>>(() => columns.map((column) => ({
    id: column.id,
    accessorFn: column.accessor,
    header: column.header,
    cell: ({ row }) => column.render ? column.render(row.original) : displayValue(column.accessor(row.original)),
    enableSorting: column.sortable !== false,
  })), [columns]);

  const globalFilterFn: FilterFn<typeof gtmTableFeatures, T> = (row, _columnId, value) => {
    const term = String(value ?? "").trim().toLowerCase();
    return !term || getSearchText(row.original).toLowerCase().includes(term);
  };

  const table = useTable({
    features: gtmTableFeatures,
    data: rows,
    columns: tableColumns,
    getRowId: (row) => getRowId(row),
    globalFilterFn,
    initialState: {
      pagination: { pageIndex: 0, pageSize },
    },
  });

  const globalFilter = String(table.state.globalFilter ?? "");
  const pagination = table.state.pagination;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const exportRows = table.getPrePaginatedRowModel().rows.map((row) => row.original);
  const pageCount = Math.max(1, table.getPageCount());

  return <div className="gtm-table-surface">
    <div className="gtm-data-toolbar">
      <label className="gtm-data-search"><Search size={15}/><input value={globalFilter} onChange={(event) => { table.setGlobalFilter(event.target.value); table.setPageIndex(0); }} placeholder="Search these records…" aria-label="Search records"/></label>
      <label className="gtm-page-size"><span>Rows</span><select value={pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      <div className="gtm-data-count"><strong>{filteredCount}</strong><span>{globalFilter ? `matching of ${rows.length}` : "records"}</span></div>
      {exportRow ? <button className="gtm-data-export" type="button" disabled={!exportRows.length} onClick={() => downloadCsv(exportFileName, exportRows, exportRow)}><Download size={14}/><span>CSV</span></button> : null}
    </div>

    <div className="gtm-table-scroll">
      <table className="gtm-table">
        <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
          const sorted = header.column.getIsSorted();
          return <th key={header.id} style={{ width: widths.get(header.column.id) }} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
            {header.isPlaceholder ? null : header.column.getCanSort()
              ? <button type="button" className="gtm-sort-header" onClick={header.column.getToggleSortingHandler()}><table.FlexRender header={header}/>{sorted === "asc" ? <ChevronUp size={12}/> : sorted === "desc" ? <ChevronDown size={12}/> : <ChevronsUpDown size={12}/>}</button>
              : <table.FlexRender header={header}/>} 
          </th>;
        })}</tr>)}</thead>
        <tbody>
          {table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getAllCells().map((cell) => <td key={cell.id}><table.FlexRender cell={cell}/></td>)}</tr>)}
        </tbody>
      </table>
      {!filteredCount ? <div className="gtm-data-empty"><Search size={26}/><strong>{emptyTitle}</strong><span>{emptyDescription}</span></div> : null}
    </div>

    {filteredCount ? <div className="gtm-table-footer"><span>Page <strong>{pagination.pageIndex + 1}</strong> of <strong>{pageCount}</strong></span><div><button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft size={14}/>Previous</button><button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next<ChevronRight size={14}/></button></div></div> : null}
  </div>;
}
