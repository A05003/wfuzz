'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { get } from '@/lib/api';
import { money } from '@/lib/format';
import type { Dashboard } from '@/lib/types';
import AppShell, { useOpenContract } from '@/components/AppShell';
import TodayEvents from '@/components/TodayEvents';
import BookingCalendar from '@/components/BookingCalendar';
import ContractsTable from '@/components/ContractsTable';
import NewContractModal from '@/components/NewContractModal';
import SplitCard from '@/components/SplitCard';
import FieldView from '@/components/FieldView';
import { ErrorBox, Spinner } from '@/components/ui';

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  if (loading || !user) return <AppShell><Spinner /></AppShell>;
  return <AppShell>{user.role === 'supervisor' ? <FieldView /> : <ManagerDashboard />}</AppShell>;
}

function ManagerDashboard() {
  const { t } = useI18n(); const { user, version, bump, can } = useAuth(); const open = useOpenContract();
  const [d, setD] = useState<Dashboard | null>(null); const [err, setErr] = useState<unknown>(null); const [newDate, setNewDate] = useState<string | null>(null);
  const load = useCallback(() => get<Dashboard>('/api/dashboard').then((r) => { setD(r); setErr(null); }).catch(setErr), []);
  useEffect(() => { load(); }, [load, version]);
  if (err) return <ErrorBox error={err} />;
  if (!d) return <Spinner />;
  const k = d.kpis;
  const pending = d.contracts.filter((c) => c.settlement_due_today || c.settlement_overdue);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="me-auto text-xl font-bold">{t('dash.title')}{user?.role === 'owner' && user.scopeBranch == null ? ` — ${t('shell.allBranches')}` : ''}</h1>
        {can('booking.write') && <button className="btn btn-primary" onClick={() => setNewDate('')}>＋ {t('contract.new')}</button>}
      </div>

      {pending.length > 0
        ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-gold bg-gold-soft/60 px-4 py-3 text-sm text-gold-deep"><span aria-hidden>⏰</span><div className="min-w-0 flex-1"><b>{t('dash.pending', { n: pending.length })}</b> — {t('dash.pendingHint')}</div><button className="btn btn-gold btn-sm" onClick={() => open(pending[0].id)}>{t('dash.review')}</button></div>
        : <div className="rounded-xl border border-mint/40 bg-mint-soft px-4 py-3 text-sm text-mint-deep">✓ {t('dash.noPending')}</div>}

      <TodayEvents todays={d.todays} next={d.next} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('dash.kpis')}>
        <Kpi tone="navy" label={t('kpi.todayEvents')} value={k.today_events} />
        <Kpi tone="danger" label={t('kpi.pending')} value={k.settlements_pending} />
        <Kpi tone="gold" label={t('kpi.outstanding')} value={`${money(k.outstanding)}`} unit={t('currency')} />
        <Kpi tone="mint" label={t('kpi.netProfit')} value={`${money(k.net_profit)}`} unit={t('currency')} />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <BookingCalendar today={d.today} onNewContract={(date) => setNewDate(date)} />
        <SplitCard split={d.split} onSaved={bump} />
      </div>
      <ContractsTable contracts={d.contracts} today={d.today} />
      {newDate !== null && <NewContractModal initialDate={newDate || undefined} onClose={() => setNewDate(null)} onDone={(id) => { bump(); open(id); }} />}
    </div>
  );
}

function Kpi({ label, value, unit, tone }: { label: string; value: string | number; unit?: string; tone: 'navy' | 'danger' | 'gold' | 'mint' }) {
  const border = { navy: 'border-navy', danger: 'border-danger', gold: 'border-gold', mint: 'border-mint' }[tone];
  return <div className={`card border-t-[3px] !p-4 ${border}`}><div className="text-xs text-ink-muted">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums"><span className="num">{value}</span>{unit && <span className="ms-1.5 text-xs font-normal text-ink-muted">{unit}</span>}</div></div>;
}
