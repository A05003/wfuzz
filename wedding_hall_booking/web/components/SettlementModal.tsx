'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { del, post, put } from '@/lib/api';
import { useAction } from '@/lib/useAction';
import { fmtDate, money } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import type { ContractDetail, Expense } from '@/lib/types';
import { ErrorBox, Field, Modal, useToast } from './ui';

const CATS: Expense['category'][] = ['labor', 'cleaning', 'consumables', 'other'];

/** Post-Event Financial Closure Screen (إغلاق وتصفية الحفل المالي):
 *  direct expenses → net profit → rental / marketing split → same-day account closure. */
export default function SettlementModal({ detail, onClose, onChanged }: { detail: ContractDetail; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n(); const { can, user } = useAuth(); const toast = useToast(); const { run, busy, error } = useAction();
  const { contract: c, settlement: s, closure, today } = detail;
  const owner = user?.role === 'owner';
  const frozen = s?.status === 'finalized' && !owner;
  const [exp, setExp] = useState({ category: 'labor' as Expense['category'], description: '', amount: '' });
  const [ovr, setOvr] = useState({ rental: String(s?.rental_pct ?? ''), marketing: String(s?.marketing_pct ?? ''), revenue: s?.revenue_override != null ? String(s.revenue_override) : '', reason: s?.override_reason ?? '' });

  const act = async (fn: () => Promise<unknown>, msg?: string) => { const ok = await run(async () => { await fn(); return true; }); if (ok) { onChanged(); if (msg) toast(msg); } };
  const open = () => act(() => post(`/api/contracts/${c.id}/settlement`), t('settle.opened'));
  const addExpense = (e: React.FormEvent) => { e.preventDefault(); if (!s) return; act(async () => { await post(`/api/settlements/${s.id}/expenses`, { category: exp.category, description: exp.description, amount: Number(exp.amount) }); setExp({ ...exp, description: '', amount: '' }); }); };
  const voidExpense = (id: number) => { if (window.confirm(t('settle.confirmVoid'))) act(() => del(`/api/expenses/${id}`), t('settle.voided')); };
  const finalize = () => { if (s && window.confirm(t('settle.confirmFinalize'))) act(() => post(`/api/settlements/${s.id}/finalize`), t('settle.finalized')); };
  const reopen = () => { if (s && window.confirm(t('settle.confirmReopen'))) act(() => post(`/api/settlements/${s.id}/reopen`), t('settle.reopened')); };
  const saveOwner = (e: React.FormEvent) => {
    e.preventDefault(); if (!s) return;
    act(() => put(`/api/settlements/${s.id}`, { rentalPct: Number(ovr.rental), marketingPct: Number(ovr.marketing), revenueOverride: ovr.revenue === '' ? null : Number(ovr.revenue), reason: ovr.reason }), t('settle.ownerSaved'));
  };

  const checks: [boolean, string][] = [
    [closure.balanceZero, `${t('settle.chkBalance')} (${money(c.balance_due)} ${t('currency')})`],
    [closure.eventDayReached, t('settle.chkReached')],
    [closure.onEventDay, t('settle.chkSameDay')],
  ];

  return (
    <Modal wide title={`${t('settle.title')} — ${c.contract_number}`} onClose={onClose}>
      <ErrorBox error={error} />
      {!closure.eventDayReached && (
        <div className="grid place-items-center gap-2 rounded-2xl bg-canvas p-10 text-center"><div className="text-4xl" aria-hidden>🗓️</div><h3 className="font-bold">{t('settle.opensOnDay')}</h3><p className="text-sm text-ink-muted">{fmtDate(c.event_date, lang)}</p></div>
      )}
      {closure.eventDayReached && !s && (
        <div className="grid place-items-center gap-3 rounded-2xl bg-canvas p-10 text-center">
          <div className="text-4xl" aria-hidden>🧾</div><h3 className="font-bold">{t('settle.notOpened')}</h3><p className="max-w-md text-sm text-ink-muted">{t('settle.notOpenedHint')}</p>
          {can('settlement.open') && <button className="btn btn-mint" onClick={open} disabled={busy || c.status !== 'confirmed'}>{t('settle.open')}</button>}
        </div>
      )}
      {s && (
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <section aria-label={t('settle.expenses')}>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-bold">{t('settle.expenses')}</h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.status === 'finalized' ? 'bg-mint-soft text-mint-deep' : 'bg-gold-soft text-gold-deep'}`}>{t(`settle.status.${s.status}`)}</span></div>
            <div className="overflow-auto rounded-xl border border-ink-line">
              <table className="w-full"><thead><tr><th className="th">{t('settle.category')}</th><th className="th">{t('settle.description')}</th><th className="th text-end">{t('settle.amount')}</th><th className="th" /></tr></thead>
                <tbody>
                  {s.expenses.map((x) => (
                    <tr key={x.id}><td className="td">{t(`cat.${x.category}`)}</td><td className="td">{x.description}</td><td className="td text-end"><span className="num">{money(x.amount)}</span></td>
                      <td className="td text-end">{!frozen && can('expense.write') && <button className="btn btn-danger btn-sm" onClick={() => voidExpense(x.id)} title={t('settle.voidHint')}>{t('common.delete')}</button>}</td></tr>
                  ))}
                  {s.expenses.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-sm text-ink-muted">{t('settle.noExpenses')}</td></tr>}
                </tbody></table>
            </div>
            {frozen ? <div className="mt-3 rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold-deep">🔒 {t('settle.frozen')}</div> : can('expense.write') && (
              <form onSubmit={addExpense} className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-dashed border-ink-line p-3">
                <Field label={t('settle.category')}><select className="input" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value as Expense['category'] })}>{CATS.map((k) => <option key={k} value={k}>{t(`cat.${k}`)}</option>)}</select></Field>
                <Field label={`${t('settle.amount')} (${t('currency')})`}><input className="input" type="number" min="0.01" step="0.01" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} required /></Field>
                <Field label={t('settle.description')} className="col-span-2"><input className="input" value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} required maxLength={200} placeholder={t('settle.descPh')} /></Field>
                <div className="col-span-2"><button className="btn btn-primary" disabled={busy}>＋ {t('settle.addExpense')}</button></div>
              </form>
            )}
          </section>

          <section aria-label={t('settle.summary')} className="space-y-3">
            <div className="rounded-2xl bg-navy p-4 text-white">
              <Row label={`${t('settle.revenue')}${s.revenue_override != null ? ` (${t('settle.overridden')})` : ''}`} value={money(s.total_revenue)} />
              <Row label={`− ${t('settle.directExpenses')}`} value={money(s.total_expenses)} />
              <div className={`mt-2 flex items-baseline justify-between border-t border-navy-500 pt-3 ${s.net_profit < 0 ? 'text-red-300' : ''}`}>
                <span className="text-sm text-navy-200">{t('settle.netProfit')}</span><b className="num text-3xl text-gold">{money(s.net_profit)} <small className="text-sm">{t('currency')}</small></b>
              </div>
              <div className="my-3 flex h-3 overflow-hidden rounded-full bg-navy-500" aria-hidden><i className="block bg-mint" style={{ width: `${s.rental_pct}%` }} /><i className="block bg-gold" style={{ width: `${s.marketing_pct}%` }} /></div>
              <div className="flex justify-between gap-3 text-xs text-navy-200">
                <div><span><i className="me-1.5 inline-block h-2 w-2 rounded-full bg-mint" />{t('settle.rental')} ({s.rental_pct}%)</span><b className="num block text-base text-white">{money(s.rental_share)}</b></div>
                <div className="text-end"><span><i className="me-1.5 inline-block h-2 w-2 rounded-full bg-gold" />{t('settle.marketing')} ({s.marketing_pct}%)</span><b className="num block text-base text-white">{money(s.marketing_share)}</b></div>
              </div>
            </div>

            <ul className="space-y-1.5 text-sm" aria-label={t('settle.closureRules')}>
              {checks.map(([ok, txt]) => <li key={txt} className="flex items-center gap-2"><span className={ok ? 'text-mint-deep' : 'text-danger'} aria-hidden>{ok ? '✓' : '✕'}</span><span className="sr-only">{ok ? t('common.yes') : t('common.no')}</span>{txt}</li>)}
            </ul>
            {s.status === 'finalized'
              ? <div className="rounded-xl bg-mint-soft px-3 py-2 text-sm text-mint-deep">✓ {s.settled_on_event_day ? t('settle.closedSameDay') : t('settle.closedLate')}{s.finalized_at ? ` — ${fmtDate(s.finalized_at, lang)}` : ''}</div>
              : can('settlement.finalize') && <><button className="btn btn-mint w-full" disabled={!closure.canFinalize || busy} onClick={finalize}>{t('settle.finalize')}</button>
                  {!closure.canFinalize && <p className="text-xs text-ink-muted">{t('settle.finalizeBlocked')}</p>}</>}
            {today !== c.event_date && s.status !== 'finalized' && closure.eventDayReached && <p className="text-xs text-danger">{t('settle.late')}</p>}

            {owner ? (
              <form onSubmit={saveOwner} className="rounded-xl border border-dashed border-gold bg-gold-soft/30 p-3">
                <h4 className="mb-2 text-sm font-bold text-gold-deep">🔑 {t('settle.ownerOnly')}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={`${t('settle.rental')} %`}><input className="input" type="number" min="0" max="100" step="0.5" value={ovr.rental} onChange={(e) => setOvr({ ...ovr, rental: e.target.value })} /></Field>
                  <Field label={`${t('settle.marketing')} %`}><input className="input" type="number" min="0" max="100" step="0.5" value={ovr.marketing} onChange={(e) => setOvr({ ...ovr, marketing: e.target.value })} /></Field>
                  <Field label={t('settle.overrideRevenue')}><input className="input" type="number" min="0" step="0.01" value={ovr.revenue} onChange={(e) => setOvr({ ...ovr, revenue: e.target.value })} placeholder={money(c.total_amount)} /></Field>
                  <Field label={t('settle.overrideReason')}><input className="input" value={ovr.reason} onChange={(e) => setOvr({ ...ovr, reason: e.target.value })} /></Field>
                </div>
                <div className="mt-2 flex gap-2"><button className="btn btn-gold btn-sm" disabled={busy}>{t('common.save')}</button>{s.status === 'finalized' && <button type="button" className="btn btn-sm" onClick={reopen}>{t('settle.reopen')}</button>}</div>
              </form>
            ) : <div className="rounded-xl bg-gold-soft px-3 py-2 text-xs text-gold-deep">🔒 {t('settle.managerLocked', { a: s.rental_pct, b: s.marketing_pct })}</div>}
          </section>
        </div>
      )}
    </Modal>
  );
}
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between py-1 text-sm text-navy-200"><span>{label}</span><b className="num text-white">{value}</b></div>; }
