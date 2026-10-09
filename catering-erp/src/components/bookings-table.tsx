"use client";

import { useState } from "react";
import { createColumnDef } from "./bookings-columns";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import type { BookingRow } from "./bookings-columns";

export function BookingsTable({ data }: { data: BookingRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");
  const table = useReactTable({
    data,
    columns: createColumnDef(),
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  return (
    <div className="card space-y-3">
      <input className="input max-w-xs" placeholder="بحث..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table className="w-full text-sm">
        <thead className="bg-navy text-white">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="cursor-pointer p-2 text-right" onClick={h.column.getToggleSortingHandler()}>
                  <span className="inline-flex items-center gap-1">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <ArrowUpDown size={12} className="text-gold" />
                  </span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} className="border-b hover:bg-gold-100">
              {r.getVisibleCells().map((c) => <td key={c.id} className="p-2">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
            </tr>
          ))}
          {!table.getRowModel().rows.length && <tr><td colSpan={7} className="p-6 text-center text-gray-400">لا توجد حجوزات</td></tr>}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-sm">
        <button className="btn" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>السابق</button>
        <span>صفحة {table.getState().pagination.pageIndex + 1} من {Math.max(table.getPageCount(), 1)}</span>
        <button className="btn" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>التالي</button>
      </div>
    </div>
  );
}
