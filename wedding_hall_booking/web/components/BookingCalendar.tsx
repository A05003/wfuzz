'use client';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { get } from '@/lib/api';
import { localName, ymd } from '@/lib/format';
import type { CalendarEvent, Hall, Section } from '@/lib/types';
import { useOpenContract } from './AppShell';

const CHIP: Record<Section, string> = { women: 'bg-pink-100 text-pink-900 border-pink-300', men: 'bg-blue-100 text-blue-900 border-blue-300', both: 'bg-violet-100 text-violet-900 border-violet-300' };

/** Interactive booking calendar: month grid, hall filter, click an event to open the contract, click a free day to book it. */
export default function BookingCalendar({ today, onNewContract }: { today: string; onNewContract: (date: string) => void }) {
  const { t, lang } = useI18n(); const { version, can } = useAuth(); const open = useOpenContract();
  const [month, setMonth] = useState(today.slice(0, 7)); const [hall, setHall] = useState(''); const [halls, setHalls] = useState<Hall[]>([]); const [events, setEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => { get<{ halls: Hall[] }>('/api/halls').then((r) => setHalls(r.halls)).catch(() => {}); }, [version]);
  useEffect(() => { get<{ events: CalendarEvent[] }>(`/api/calendar?month=${month}${hall ? `&hall=${hall}` : ''}`).then((r) => setEvents(r.events)).catch(() => setEvents([])); }, [month, hall, version]);

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1); const lead = first.getDay();           // Sunday-first grid
  const days = new Date(y, m, 0).getDate();
  const cells = useMemo(() => Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => { const n = i - lead + 1; return n >= 1 && n <= days ? n : 0; }), [lead, days]);
  const shift = (d: number) => { const x = new Date(y, m - 1 + d, 1); setMonth(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); };
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { weekday: 'short' }));
  const title = first.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { month: 'long', year: 'numeric' });
  const byDay = (n: number) => events.filter((e) => e.event_date === `${month}-${String(n).padStart(2, '0')}`);

  return (
    <section className="card" aria-label={t('cal.title')}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-lg font-bold">{t('cal.title')}</h2>
        {halls.length > 1 && <select aria-label={t('cal.hall')} className="input !w-auto !py-1.5" value={hall} onChange={(e) => setHall(e.target.value)}><option value="">{t('cal.allHalls')}</option>{halls.map((h) => <option key={h.id} value={h.id}>{localName(h, lang)}</option>)}</select>}
        <div className="flex items-center gap-1">
          <button className="btn btn-sm" onClick={() => shift(-1)} aria-label={t('cal.prev')}>{lang === 'ar' ? '›' : '‹'}</button>
          <b className="min-w-[8.5rem] text-center text-sm">{title}</b>
          <button className="btn btn-sm" onClick={() => shift(1)} aria-label={t('cal.next')}>{lang === 'ar' ? '‹' : '›'}</button>
          <button className="btn btn-sm" onClick={() => setMonth(today.slice(0, 7))}>{t('cal.today')}</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-ink-line bg-ink-line text-xs" role="grid">
        {weekdays.map((w) => <div key={w} className="bg-canvas py-1.5 text-center font-semibold text-ink-muted" role="columnheader">{w}</div>)}
        {cells.map((n, i) => {
          if (!n) return <div key={i} className="min-h-[84px] bg-canvas/60" />;
          const date = `${month}-${String(n).padStart(2, '0')}`; const ev = byDay(n); const isToday = date === today; const future = date >= today;
          return (
            <div key={i} role="gridcell" className={`group relative min-h-[84px] bg-white p-1 ${isToday ? 'ring-2 ring-inset ring-gold' : ''}`}>
              <div className="flex items-center justify-between">
                <span className={`num grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${isToday ? 'bg-navy text-gold' : 'text-ink-muted'}`}>{n}</span>
                {future && can('booking.write') && <button onClick={() => onNewContract(date)} aria-label={`${t('contract.new')} ${date}`} className="rounded-md px-1.5 text-sm text-mint-deep opacity-0 transition hover:bg-mint-soft focus:opacity-100 group-hover:opacity-100">＋</button>}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {ev.slice(0, 3).map((e) => (
                  <button key={e.id} onClick={() => open(e.id)} title={`${e.contract_number} — ${e.client_name}`}
                    className={`flex w-full items-center gap-1 truncate rounded border px-1 py-px text-start text-[10.5px] leading-snug ${CHIP[e.section]} ${e.status === 'closed' ? 'opacity-60' : ''}`}>
                    <i className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${e.status === 'closed' ? 'bg-mint' : e.settlement_overdue ? 'bg-danger' : e.balance_due > 0 ? 'bg-gold-deep' : 'bg-mint'}`} aria-hidden />
                    <span className="truncate">{e.client_name}</span>
                  </button>
                ))}
                {ev.length > 3 && <div className="px-1 text-[10px] text-ink-muted">+{ev.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted" aria-hidden>
        {(['women', 'men', 'both'] as const).map((s) => <span key={s}><i className={`me-1 inline-block h-2.5 w-2.5 rounded border ${CHIP[s]}`} />{t(`section.${s}`)}</span>)}
        <span><i className="me-1 inline-block h-2 w-2 rounded-full bg-gold-deep" />{t('cal.owes')}</span><span><i className="me-1 inline-block h-2 w-2 rounded-full bg-danger" />{t('cal.late')}</span><span><i className="me-1 inline-block h-2 w-2 rounded-full bg-mint" />{t('cal.paid')}</span>
      </div>
    </section>
  );
}
