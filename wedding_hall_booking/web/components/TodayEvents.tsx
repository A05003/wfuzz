'use client';
import { useI18n } from '@/lib/i18n';
import { fmtDate, localName, money } from '@/lib/format';
import type { Contract, ContractDetail } from '@/lib/types';
import { SectionBadge } from './ui';
import { useOpenContract } from './AppShell';

/** Today's event(s) at a glance — concise bullet points (رؤوس أقلام). */
export default function TodayEvents({ todays, next }: { todays: ContractDetail[]; next: Contract | null }) {
  const { t, lang } = useI18n(); const open = useOpenContract();
  return (
    <section aria-label={t('today.title')}>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><span className="h-5 w-1.5 rounded-full bg-gold" aria-hidden />{t('today.title')}</h2>
      {todays.length === 0 ? (
        <div className="card">
          <p className="font-semibold">{t('today.none')}</p>
          {next && (
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-ink-muted">
              <li>{t('today.next')}: <b className="text-ink">{fmtDate(next.event_date, lang)}</b></li>
              <li>{next.client_name} — <span className="num">{next.contract_number}</span> — {localName({ name_ar: next.hall_name_ar, name_en: next.hall_name_en }, lang)}</li>
              <li>{t('fin.balance')}: <b className="num text-ink">{money(next.balance_due)}</b> {t('currency')}</li>
            </ul>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {todays.map((d) => <EventCard key={d.contract.id} d={d} onOpen={() => open(d.contract.id)} />)}
        </div>
      )}
    </section>
  );
}

function EventCard({ d, onOpen }: { d: ContractDetail; onOpen: () => void }) {
  const { t, lang } = useI18n(); const c = d.contract; const s = d.settlement;
  const svc = d.services.length ? d.services.map((x) => (x.quantity !== 1 ? `${x.name} ×${x.quantity}` : x.name)).join('، ') : t('today.noServices');
  const next = c.status === 'closed' ? t('today.closed')
    : c.balance_due > 0 ? t('today.stepCollect', { amount: money(c.balance_due) })
    : !s ? t('today.stepOpen') : t('today.stepFinalize');
  return (
    <article className="card border-s-4 border-gold">
      <header className="mb-2 flex flex-wrap items-center gap-2"><SectionBadge section={c.section} /><b>{localName({ name_ar: c.hall_name_ar, name_en: c.hall_name_en }, lang)}</b><span className="num ms-auto text-xs font-semibold text-ink-muted">{c.contract_number}</span></header>
      <ul className="list-disc space-y-1.5 ps-5 text-sm marker:text-gold">
        <li><span className="text-ink-muted">{t('contract.client')}:</span> <b>{c.client_name}</b> — <span className="num text-ink-muted">{c.client_phone}</span></li>
        <li><span className="text-ink-muted">{t('fin.total')}:</span> <b className="num">{money(c.total_amount)}</b> · <span className="text-ink-muted">{t('fin.paid')}:</span> <b className="num text-mint-deep">{money(c.paid_total)}</b> · <span className="text-ink-muted">{t('fin.balance')}:</span> <b className={`num ${c.balance_due > 0 ? 'text-danger' : 'text-mint-deep'}`}>{money(c.balance_due)}</b></li>
        <li><span className="text-ink-muted">{t('drawer.services')}:</span> {svc}</li>
        <li><span className="text-ink-muted">{t('drawer.receipts')}:</span> <b className="num">{d.payments.length}</b>{d.payments.length ? ` — ${t('today.lastReceipt')} ${t(`method.${d.payments[d.payments.length - 1].method}`)}` : ''}</li>
        <li><span className="text-ink-muted">{t('settle.title')}:</span> {c.status === 'closed' ? <b className="text-mint-deep">{t('settle.status.finalized')}{s ? ` · ${t('settle.netProfit')} ${money(s.net_profit)}` : ''}</b> : s ? <b>{t('settle.status.draft')} · {t('settle.directExpenses')} {money(s.total_expenses)}</b> : <b>{t('settle.notOpenedShort')}</b>}</li>
        <li className="font-semibold text-gold-deep">{t('today.next')}: {next}</li>
      </ul>
      <div className="mt-3 flex gap-2"><button className="btn btn-primary btn-sm" onClick={onOpen}>{t('today.openContract')}</button></div>
    </article>
  );
}
