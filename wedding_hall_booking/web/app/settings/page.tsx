'use client';
import { useState } from 'react';
import { useRequireAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import AppShell from '@/components/AppShell';
import { Spinner, Tabs } from '@/components/ui';
import { BranchesAdmin, UsersAdmin, VenueForm } from '@/components/SettingsPanels';

type Tab = 'branches' | 'users' | 'venue';
const OWNER_ONLY = ['owner'] as ('owner')[];

export default function SettingsPage() {
  const { user, loading } = useRequireAuth(OWNER_ONLY); const { t } = useI18n(); const [tab, setTab] = useState<Tab>('branches');
  if (loading || !user || user.role !== 'owner') return <AppShell><Spinner /></AppShell>;
  return (
    <AppShell>
      <div className="space-y-5"><h1 className="text-xl font-bold">{t('nav.settings')}</h1>
        <div className="overflow-hidden rounded-2xl bg-white shadow-card"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'branches', label: t('set.branchesHalls') }, { id: 'users', label: t('set.users') }, { id: 'venue', label: t('set.venue') }]} />
          <div className="bg-canvas p-4 md:p-5">{tab === 'branches' && <BranchesAdmin />}{tab === 'users' && <UsersAdmin />}{tab === 'venue' && <VenueForm />}</div></div></div>
    </AppShell>
  );
}
