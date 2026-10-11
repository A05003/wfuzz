'use client';
import { useState } from 'react';
import { useRequireAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import AppShell from '@/components/AppShell';
import { Spinner, Tabs } from '@/components/ui';
import { AuditTrail, BranchInspection, DeletedItems, LoginHistory, Overview, SessionsAndEvents } from '@/components/SecurityPanels';

type Tab = 'branches' | 'audit' | 'deleted' | 'logins' | 'sessions';
const OWNER_ONLY = ['owner'] as ('owner')[];

/** Super Admin Security & Audit Trail page. */
export default function SecurityPage() {
  const { user, loading } = useRequireAuth(OWNER_ONLY); const { t } = useI18n(); const [tab, setTab] = useState<Tab>('audit');
  if (loading || !user || user.role !== 'owner') return <AppShell><Spinner /></AppShell>;
  return (
    <AppShell>
      <div className="space-y-5">
        <div><h1 className="text-xl font-bold">{t('sec.title')}</h1><p className="text-sm text-ink-muted">{t('sec.subtitle')}</p></div>
        <Overview />
        <div className="overflow-hidden rounded-2xl bg-white shadow-card">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'audit', label: t('sec.tabAudit') }, { id: 'deleted', label: t('sec.tabDeleted') }, { id: 'logins', label: t('sec.tabLogins') }, { id: 'branches', label: t('sec.tabBranches') }, { id: 'sessions', label: t('sec.tabSessions') }]} />
          <div className="p-4 md:p-5">
            {tab === 'audit' && <AuditTrail />}{tab === 'deleted' && <DeletedItems />}{tab === 'logins' && <LoginHistory />}{tab === 'branches' && <BranchInspection />}{tab === 'sessions' && <SessionsAndEvents />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
