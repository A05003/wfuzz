'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { get, patch, post } from '@/lib/api';
import { useAction } from '@/lib/useAction';
import { localName, money } from '@/lib/format';
import type { ChecklistItem, Expense, FieldEvent } from '@/lib/types';
import { Empty, ErrorBox, Field, SectionBadge, Spinner, useToast } from './ui';

const CATS: Expense['category'][] = ['labor', 'cleaning', 'consumables', 'other'];
const ICON: Record<string, string> = { catering: '🍽️', screens: '📺', sound: '🔊', seating: '🪑', cleaning: '🧹', other: '📌' };

/** Restricted view for field supervisors / receptionists: today's active events, the daily checklist, direct expense inputs. No contract money. */
export default function FieldView() {
  const { t, lang } = useI18n(); const { version, bump } = useAuth();
  const [events, setEvents] = useState<FieldEvent[] | null>(null);
  const load = useCallback(() => get<{ events: FieldEvent[] }>('/api/field/today').then((r) => setEvents(r.events)).catch(() => setEvents([])), []);
  useEffect(() => { load(); }, [load, version]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);   // keep the floor screen fresh
  if (!events) return <Spinner />;
  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold">{t('field.title')}</h1><p className="text-sm text-ink-muted">{t('field.hint')}</p></div>
      {events.length === 0 && <div className="card"><Empty>{t('field.none')}</Empty></div>}
      <div className="grid gap-5 lg:grid-cols-2">{events.map((e) => <EventPanel key={e.id} e={e} onChange={() => { load(); bump(); }} lang={lang} />)}</div>
    </div>
  );
}

function EventPanel({ e, onChange, lang }: { e: FieldEvent; onChange: () => void; lang: 'ar' | 'en' }) {
  const { t } = useI18n(); const toast = useToast(); const { run, busy, error } = useAction();
  const [exp, setExp] = useState({ category: 'labor' as Expense['category'], description: '', amount: '' }); const [custom, setCustom] = useState('');
  const [flip, setFlip] = useState<Record<number, boolean>>({});                       // optimistic ticks until the server answers
  useEffect(() => setFlip({}), [e.checklist]);
  const isDone = (c: ChecklistItem) => flip[c.id] ?? c.is_done;
  const done = e.checklist.filter(isDone).length;
  const label = (c: ChecklistItem) => (c.title.startsWith('chk.') ? t(c.title) : c.title);
  const toggle = (c: ChecklistItem) => { const next = !isDone(c); setFlip((f) => ({ ...f, [c.id]: next }));
    run(async () => { try { await patch(`/api/checklist/${c.id}`, { isDone: next, note: c.note }); onChange(); } catch (err) { setFlip((f) => { const { [c.id]: _x, ...rest } = f; return rest; }); throw err; } }); };
  const init = () => run(async () => { await post(`/api/field/events/${e.id}/checklist/init`); onChange(); });
  const addItem = (ev: React.FormEvent) => { ev.preventDefault(); run(async () => { await post(`/api/field/events/${e.id}/checklist`, { category: 'other', title: custom }); setCustom(''); onChange(); }); };
  const addExpense = (ev: React.FormEvent) => { ev.preventDefault(); run(async () => { await post(`/api/field/events/${e.id}/expenses`, { category: exp.category, description: exp.description, amount: Number(exp.amount) }); setExp({ ...exp, description: '', amount: '' }); toast(t('field.expenseSaved')); onChange(); }); };
  return (
    <article className="card space-y-4 border-s-4 border-gold">
      <header className="flex flex-wrap items-center gap-2"><SectionBadge section={e.section} /><b>{localName({ name_ar: e.hall_name_ar, name_en: e.hall_name_en }, lang)}</b><span className="ms-auto text-sm text-ink-muted">{e.client_name} · <span className="num">{e.contract_number}</span></span></header>
      <ErrorBox error={error} />
      <section aria-label={t('field.checklist')}>
        <div className="mb-2 flex items-center justify-between"><h3 className="font-bold">{t('field.checklist')}</h3>{e.checklist.length > 0 && <span className="rounded-full bg-mint-soft px-2.5 py-0.5 text-xs font-bold text-mint-deep">{done}/{e.checklist.length}</span>}</div>
        {e.checklist.length === 0 ? <button className="btn btn-mint" onClick={init} disabled={busy}>{t('field.startChecklist')}</button> : (
          <>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden><div className="h-full bg-mint transition-all" style={{ width: `${(done / e.checklist.length) * 100}%` }} /></div>
            <ul className="space-y-1.5">{e.checklist.map((c) => (
              <li key={c.id}><label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${isDone(c) ? 'border-mint/40 bg-mint-soft/60' : 'border-ink-line bg-white hover:bg-gold-soft/40'}`}>
                <input type="checkbox" className="h-5 w-5 accent-[#10B981]" checked={isDone(c)} onChange={() => toggle(c)} />
                <span aria-hidden>{ICON[c.category] || '📌'}</span><span className={isDone(c) ? 'text-ink-muted line-through' : 'font-medium'}>{label(c)}</span></label></li>))}</ul>
            <form onSubmit={addItem} className="mt-3 flex gap-2"><input className="input" value={custom} onChange={(ev) => setCustom(ev.target.value)} placeholder={t('field.customItem')} maxLength={120} required /><button className="btn" disabled={busy}>＋</button></form>
          </>)}
      </section>
      <section aria-label={t('field.expenses')}>
        <h3 className="mb-2 font-bold">{t('field.expenses')}</h3>
        {e.expenses.length > 0 && <ul className="mb-3 divide-y divide-ink-line rounded-xl border border-ink-line bg-white text-sm">{e.expenses.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2"><span><span className="text-ink-muted">{t(`cat.${x.category}`)}</span> · {x.description}</span><b className="num">{money(x.amount)} {t('currency')}</b></li>)}</ul>}
        <form onSubmit={addExpense} className="grid grid-cols-2 gap-3 rounded-xl border border-dashed border-ink-line p-3">
          <Field label={t('settle.category')}><select className="input" value={exp.category} onChange={(ev) => setExp({ ...exp, category: ev.target.value as Expense['category'] })}>{CATS.map((k) => <option key={k} value={k}>{t(`cat.${k}`)}</option>)}</select></Field>
          <Field label={`${t('settle.amount')} (${t('currency')})`}><input className="input" type="number" min="0.01" step="0.01" value={exp.amount} onChange={(ev) => setExp({ ...exp, amount: ev.target.value })} required /></Field>
          <Field label={t('settle.description')} className="col-span-2"><input className="input" value={exp.description} onChange={(ev) => setExp({ ...exp, description: ev.target.value })} required maxLength={200} placeholder={t('settle.descPh')} /></Field>
          <div className="col-span-2"><button className="btn btn-primary" disabled={busy}>＋ {t('settle.addExpense')}</button></div>
        </form>
      </section>
    </article>
  );
}
