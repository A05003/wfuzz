'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { del, get, post } from '@/lib/api';
import { useAction } from '@/lib/useAction';
import { fmtDate, fmtDateTime, localName, money } from '@/lib/format';
import type { ContractDetail } from '@/lib/types';
import { Empty, ErrorBox, Field, SectionBadge, Spinner, Stat, StatusBadge, Tabs, useToast } from './ui';
import AddServiceModal from './AddServiceModal';
import SettlementModal from './SettlementModal';

type Tab = 'overview' | 'services' | 'receipts' | 'settlement';

/** Contract workspace: overview, services (dynamic add-ons), receipts, and the post-event settlement. */
export default function ContractDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, lang } = useI18n(); const { can, user, version, bump } = useAuth(); const toast = useToast();
  const [d, setD] = useState<ContractDetail | null>(null); const [tab, setTab] = useState<Tab>('overview'); const [loadErr, setLoadErr] = useState<unknown>(null);
  const [addOpen, setAddOpen] = useState(false); const [settleOpen, setSettleOpen] = useState(false);
  const { run, busy, error } = useAction();
  const [pay, setPay] = useState({ amount: '', method: 'cash', note: '' });

  const load = useCallback(async () => { try { setD(await get<ContractDetail>(`/api/contracts/${id}`)); setLoadErr(null); } catch (e) { setLoadErr(e); } }, [id]);
  useEffect(() => { load(); }, [load, version]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => { if (d && pay.amount === '' && d.contract.balance_due > 0) setPay((p) => ({ ...p, amount: String(d.contract.balance_due) })); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = () => { load(); bump(); };
  if (loadErr) return <Shell onClose={onClose}><div className="p-6"><ErrorBox error={loadErr} /></div></Shell>;
  if (!d) return <Shell onClose={onClose}><Spinner /></Shell>;
  const c = d.contract; const owner = user?.role === 'owner';
  // the same rules the database enforces, to disable what would be refused
  const editable = c.status === 'confirmed' && (owner || d.today <= c.event_date);
  const receiptsOpen = c.status === 'confirmed' || owner;

  const submitPay = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const r = await post<{ receiptNumber: string }>(`/api/contracts/${id}/payments`, { amount: Number(pay.amount), method: pay.method, note: pay.note }); setPay({ amount: '', method: 'cash', note: '' }); toast(t('receipt.issued', { n: r.receiptNumber, c: c.contract_number })); changed(); }); };
  const voidPay = (pid: number) => { if (window.confirm(t('receipt.confirmVoid'))) run(async () => { await del(`/api/payments/${pid}`); toast(t('common.archived')); changed(); }); };
  const voidSvc = (sid: number) => { if (window.confirm(t('service.confirmVoid'))) run(async () => { await del(`/api/services/${sid}`); toast(t('common.archived')); changed(); }); };
  const cancel = () => { if (window.confirm(t('contract.confirmCancel'))) run(async () => { await post(`/api/contracts/${id}/cancel`); toast(t('contract.cancelled')); bump(); onClose(); }); };

  const tabs = [{ id: 'overview' as Tab, label: t('drawer.overview') }, { id: 'services' as Tab, label: t('drawer.services') }, { id: 'receipts' as Tab, label: t('drawer.receipts') }, { id: 'settlement' as Tab, label: t('drawer.settlement') }];
  const dueMsg = c.status === 'confirmed' && (c.settlement_due_today || c.settlement_overdue);

  return (
    <Shell onClose={onClose}>
      <div className="flex items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
        <div>
          <h2 className="flex flex-wrap items-center gap-2.5 text-lg font-bold"><span className="num text-gold">{c.contract_number}</span><StatusBadge c={c} /></h2>
          <p className="mt-1 text-xs text-navy-300">{c.client_name} · {fmtDate(c.event_date, lang)} · {localName({ name_ar: c.hall_name_ar, name_en: c.hall_name_en }, lang)}{user?.role === 'owner' ? ` · ${localName({ name_ar: c.branch_name_ar, name_en: c.branch_name_en }, lang)}` : ''}</p>
        </div>
        <button onClick={onClose} aria-label={t('common.close')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy-500 text-lg leading-none hover:bg-navy-400">×</button>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="flex-1 space-y-4 overflow-auto bg-canvas p-5">
        <div className="grid grid-cols-3 gap-2.5"><Stat label={t('fin.total')} value={<span className="num">{money(c.total_amount)}</span>} /><Stat label={t('fin.paid')} value={<span className="num">{money(c.paid_total)}</span>} tone="ok" /><Stat label={t('fin.balance')} value={<span className="num">{money(c.balance_due)}</span>} tone="dark" /></div>
        <ErrorBox error={error} />

        {tab === 'overview' && (
          <>
            {dueMsg && <div role="alert" className="flex gap-3 rounded-xl border border-gold bg-gold-soft/60 p-3 text-sm text-gold-deep"><span aria-hidden>⏰</span><div>{c.settlement_overdue ? t('drawer.overdueMsg') : t('drawer.todayMsg')} {c.balance_due > 0 ? t('drawer.collectMsg', { amount: money(c.balance_due) }) : t('drawer.readyMsg')}
              <button className="btn btn-gold btn-sm ms-3" onClick={() => setSettleOpen(true)}>{t('drawer.openSettlement')}</button></div></div>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl bg-white p-4 text-sm shadow-card">
              <dt className="text-ink-muted">{t('contract.number')}</dt><dd className="font-semibold"><span className="num">{c.contract_number}</span></dd>
              <dt className="text-ink-muted">{t('contract.client')}</dt><dd className="font-semibold">{c.client_name} — <span className="num">{c.client_phone}</span></dd>
              <dt className="text-ink-muted">{t('contract.date')}</dt><dd className="font-semibold">{fmtDate(c.event_date, lang)}</dd>
              <dt className="text-ink-muted">{t('contract.section')}</dt><dd><SectionBadge section={c.section} /></dd>
              <dt className="text-ink-muted">{t('contract.base')}</dt><dd className="font-semibold"><span className="num">{money(c.base_amount)}</span> {t('currency')}</dd>
              <dt className="text-ink-muted">{t('contract.discount')}</dt><dd className="font-semibold"><span className="num">{money(c.discount)}</span> {t('currency')}</dd>
              <dt className="text-ink-muted">{t('drawer.servicesTotal')}</dt><dd className="font-semibold"><span className="num">{money(c.services_total)}</span> {t('currency')}</dd>
            </dl>
            {can('booking.write') && c.status === 'confirmed' && <button className="btn btn-danger" onClick={cancel} disabled={busy}>{t('contract.cancel')}</button>}
          </>
        )}

        {tab === 'services' && (
          <>
            <div className="flex items-center justify-between"><h3 className="font-bold">{t('drawer.servicesOf', { n: c.contract_number })}</h3>
              {can('service.write') && <button className="btn btn-mint" disabled={!editable} onClick={() => setAddOpen(true)}>＋ {t('service.add')}</button>}</div>
            {!editable && <div className="rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold-deep">🔒 {c.status !== 'confirmed' ? t('lock.status') : t('lock.passed')}</div>}
            {editable && <p className="text-xs text-ink-muted">{t('service.anytime')}</p>}
            <div className="overflow-auto rounded-xl border border-ink-line bg-white"><table className="w-full"><thead><tr><th className="th">{t('service.name')}</th><th className="th">{t('service.qty')}</th><th className="th text-end">{t('service.unitPrice')}</th><th className="th text-end">{t('fin.total')}</th><th className="th">{t('service.addedOn')}</th><th className="th" /></tr></thead>
              <tbody>{d.services.map((s) => <tr key={s.id}><td className="td">{s.name}</td><td className="td"><span className="num">{s.quantity}</span></td><td className="td text-end"><span className="num">{money(s.unit_price)}</span></td><td className="td text-end"><span className="num">{money(s.line_total)}</span></td><td className="td">{fmtDate(s.added_at, lang, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td className="td text-end">{editable && can('service.write') && <button className="btn btn-danger btn-sm" onClick={() => voidSvc(s.id)}>{t('common.delete')}</button>}</td></tr>)}
                {d.services.length === 0 && <tr><td colSpan={6}><Empty>{t('service.none')}</Empty></td></tr>}</tbody></table></div>
          </>
        )}

        {tab === 'receipts' && (
          <>
            <h3 className="font-bold">{t('drawer.receipts')}</h3>
            <div className="overflow-auto rounded-xl border border-ink-line bg-white"><table className="w-full"><thead><tr><th className="th">{t('receipt.number')}</th><th className="th">{t('contract.number')}</th><th className="th">{t('receipt.date')}</th><th className="th">{t('receipt.method')}</th><th className="th text-end">{t('settle.amount')}</th><th className="th" /></tr></thead>
              <tbody>{d.payments.map((p) => <tr key={p.id}><td className="td"><b className="num">{p.receipt_number}</b></td><td className="td"><span className="num">{p.contract_number}</span></td><td className="td">{fmtDateTime(p.received_at, lang)}</td><td className="td">{t(`method.${p.method}`)}</td><td className="td text-end"><span className="num">{money(p.amount)}</span></td>
                <td className="td text-end">{receiptsOpen && can('payment.write') && <button className="btn btn-danger btn-sm" onClick={() => voidPay(p.id)}>{t('common.delete')}</button>}</td></tr>)}
                {d.payments.length === 0 && <tr><td colSpan={6}><Empty>{t('receipt.none')}</Empty></td></tr>}</tbody></table></div>
            {receiptsOpen && can('payment.write') ? (
              <form onSubmit={submitPay} className="grid grid-cols-2 gap-3 rounded-xl bg-white p-4 shadow-card">
                <h4 className="col-span-2 text-sm font-bold">{t('receipt.new')}</h4>
                <Field label={`${t('settle.amount')} (${t('currency')})`}><input className="input" type="number" min="0.01" step="0.01" max={Math.max(c.balance_due, 0)} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required /></Field>
                <Field label={t('receipt.method')}><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{(['cash', 'card', 'transfer'] as const).map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}</select></Field>
                <Field label={t('receipt.note')} className="col-span-2"><input className="input" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} maxLength={200} /></Field>
                <div className="col-span-2 flex items-center gap-3"><button className="btn btn-mint" disabled={busy || c.balance_due <= 0}>{t('receipt.issue')}</button><span className="text-xs text-ink-muted">{t('receipt.bindNote', { n: c.contract_number })}</span></div>
              </form>
            ) : <div className="rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold-deep">🔒 {t('lock.status')}</div>}
          </>
        )}

        {tab === 'settlement' && (
          <div className="space-y-3 rounded-xl bg-white p-4 shadow-card">
            <h3 className="font-bold">{t('settle.title')}</h3>
            {d.settlement
              ? <ul className="list-disc space-y-1 ps-5 text-sm"><li>{t('settle.status')}: <b>{t(`settle.status.${d.settlement.status}`)}</b></li><li>{t('settle.directExpenses')}: <b className="num">{money(d.settlement.total_expenses)}</b></li><li>{t('settle.netProfit')}: <b className="num">{money(d.settlement.net_profit)}</b></li><li>{t('settle.rental')} / {t('settle.marketing')}: <b className="num">{money(d.settlement.rental_share)}</b> / <b className="num">{money(d.settlement.marketing_share)}</b></li></ul>
              : <p className="text-sm text-ink-muted">{d.closure.eventDayReached ? t('settle.notOpenedHint') : t('settle.opensOnDay')}</p>}
            <button className="btn btn-primary" onClick={() => setSettleOpen(true)}>{t('drawer.openSettlement')}</button>
          </div>
        )}
      </div>
      {addOpen && <AddServiceModal contract={c} onClose={() => setAddOpen(false)} onDone={changed} />}
      {settleOpen && <SettlementModal detail={d} onClose={() => setSettleOpen(false)} onChanged={changed} />}
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/40" onClick={onClose} aria-hidden />
      <aside aria-label="contract" className="fixed inset-y-0 start-0 z-50 flex w-full max-w-[780px] flex-col bg-canvas shadow-2xl">{children}</aside>
    </>
  );
}
