"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { fmt } from "@/lib/money";

export type AccountNode = { id: string; code: string; nameAr: string; nameEn: string | null; type: string; balance: string; children: AccountNode[] };

function Node({ n, depth }: { n: AccountNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const has = n.children.length > 0;
  return (
    <li>
      <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gold-100" style={{ paddingInlineStart: depth * 20 + 8 }}>
        {has ? (
          <button onClick={() => setOpen(!open)} aria-label="toggle">{open ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}</button>
        ) : <span className="w-3.5" />}
        <span className="font-mono text-xs text-gray-500">{n.code}</span>
        <span className={has ? "font-semibold" : ""}>{n.nameAr}</span>
        {n.nameEn && <span className="text-xs text-gray-400">{n.nameEn}</span>}
        <span className="ms-auto text-sm tabular-nums">{fmt(n.balance)}</span>
      </div>
      {has && open && <ul>{n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function AccountsTree({ roots }: { roots: AccountNode[] }) {
  return <ul className="card">{roots.map((r) => <Node key={r.id} n={r} depth={0} />)}</ul>;
}
