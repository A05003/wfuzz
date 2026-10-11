'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { get } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { Contract } from '@/lib/types';

/** Quick contract search: contract number, client name or phone. Press "/" to focus. */
export default function QuickSearch({ onOpen }: { onOpen: (id: number) => void }) {
  const { t, lang } = useI18n(); const [q, setQ] = useState(''); const [hits, setHits] = useState<Contract[]>([]); const [hi, setHi] = useState(0); const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test((document.activeElement?.tagName) || '')) { e.preventDefault(); input.current?.focus(); } };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const id = setTimeout(() => { get<{ results: Contract[] }>(`/api/contracts/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setHits(r.results); setHi(0); }).catch(() => setHits([])); }, 180);
    return () => clearTimeout(id);
  }, [q]);
  const choose = (c: Contract) => { onOpen(c.id); setQ(''); setHits([]); setOpen(false); input.current?.blur(); };
  return (
    <div className="relative min-w-0 flex-1" role="search">
      <svg viewBox="0 0 24 24" aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 fill-none stroke-navy-300" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={input} type="search" value={q} autoComplete="off" onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && hits[hi]) choose(hits[hi]); else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={t('search.placeholder')} aria-label={t('search.aria')} aria-expanded={open && q.trim().length >= 2} aria-controls="search-results"
        className="w-full rounded-xl border border-navy-500 bg-navy-600 py-2.5 pe-3 ps-10 text-[13.5px] text-white placeholder:text-navy-300/80 focus:border-gold focus:bg-[#1d2746] focus:outline-none" />
      {open && q.trim().length >= 2 && (
        <ul id="search-results" role="listbox" className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-80 overflow-auto rounded-xl bg-white p-1.5 text-ink shadow-2xl">
          {hits.length === 0 && <li className="px-3 py-3 text-center text-sm text-ink-muted">{t('search.none')}</li>}
          {hits.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === hi} onMouseDown={(e) => { e.preventDefault(); choose(c); }}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 ${i === hi ? 'bg-gold-soft' : 'hover:bg-gold-soft/60'}`}>
              <span className="min-w-0 truncate"><b className="num">{c.contract_number}</b> — {c.client_name}</span>
              <small className="shrink-0 text-ink-muted">{fmtDate(c.event_date, lang, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
