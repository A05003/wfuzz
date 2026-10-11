'use client';
import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fmtDate, localName, money } from '@/lib/format';
import type { Contract } from '@/lib/types';
import { Empty, SectionBadge, StatusBadge } from './ui';
import { useOpenContract } from './AppShell';

type Filter = 'all' | 'today' | 'settle' | 'open';

export default function ContractsTable({ contracts, today }: { contracts: Contract[]; today: string }) {
  const { t, lang } = useI18n(); const { user } = useAuth(); const open = useOpenContract();
  const [filter, setFilter] = useState<Filter>('all'); const [q, setQ] = useState('');
  const showBranch = user?.role === 'owner' && user.scopeBranch == null;
  const counts = useMemo(() => ({
    all: contracts.length, today: contracts.filter((c) => c.event_date === today).length,
    settle: contracts.filter((c) => c.settlement_due_today || c.settlement_overdue).length, open: contracts.filter((c) => c.status === 'confirmed' && c.balance_due > 0).length,
  }), [contracts, today]);
  const rows = useMemo(() => contracts.filter((c) =>
    (filter === 'all' || (filter === 'today' && c.event_date === today) || (filter === 'settle' && (c.settlement_due_today || c.settlement_overdue)) || (filter === 'open' && c.status === 'confirmed' && c.balance_due > 0))
    && (!q.trim() || `${c.contract_number} ${c.client_name} ${c.client_phone}`.toLowerCase().includes(q.trim().toLowerCase()))), [contracts, filter, q, today]);
  const chip = (k: Filter, label: string) => (
    <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full border px-3.5 py-1 text-[13px] transition ${filter === k ? 'border-navy bg-navy text-white' : 'border-ink-line bg-white hover:bg-gold-soft/60'}`}>
      {label}<span className="ms-1.5 inline-block min-w-[1.25rem] rounded-full bg-gold px-1.5 text-center text-[11px] font-bold text-navy">{counts[k]}</span></button>);
  return (
    <section className="card" aria-label={t('table.title')}>
      <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="me-auto text-lg font-bold">{t('table.title')}</h2>
        <input className="input !w-52 !py-1.5" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('table.filterPh')} aria-label={t('table.filterPh')} />
        <div className="flex flex-wrap gap-1.5">{chip('all', t('filter.all'))}{chip('today', t('filter.today'))}{chip('settle', t('filter.settle'))}{chip('open', t('filter.open'))}</div></div>
      <div className="overflow-auto rounded-xl border border-ink-line">
        <table className="w-full">
          <thead><tr><th className="th">{t('contract.number')}</th><th className="th">{t('contract.client')}</th><th className="th">{t('contract.date')}</th>{showBranch && <th className="th">{t('shell.branch')}</th>}<th className="th">{t('contract.hall')}</th><th className="th">{t('contract.section')}</th>
            <th className="th text-end">{t('fin.total')}</th><th className="th text-end">{t('fin.paid')}</th><th className="th text-end">{t('fin.balance')}</th><th className="th">{t('contract.status')}</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} tabIndex={0} onClick={() => open(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') open(c.id); }} className="cursor-pointer hover:bg-gold-soft/30" aria-label={`${t('today.openContract')} ${c.contract_number}`}>
                <td className="td"><b className="num text-navy">{c.contract_number}</b></td><td className="td">{c.client_name}</td><td className="td">{fmtDate(c.event_date, lang, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                {showBranch && <td className="td">{localName({ name_ar: c.branch_name_ar, name_en: c.branch_name_en }, lang)}</td>}
                <td className="td">{localName({ name_ar: c.hall_name_ar, name_en: c.hall_name_en }, lang)}</td><td className="td"><SectionBadge section={c.section} /></td>
                <td className="td text-end"><span className="num">{money(c.total_amount)}</span></td><td className="td text-end"><span className="num">{money(c.paid_total)}</span></td>
                <td className="td text-end"><b className={`num ${c.balance_due > 0 ? 'text-danger' : 'text-mint-deep'}`}>{money(c.balance_due)}</b></td><td className="td"><StatusBadge c={c} /></td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10}><Empty>{t('table.empty')}</Empty></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
