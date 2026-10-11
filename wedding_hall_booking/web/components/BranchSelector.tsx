'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { get } from '@/lib/api';
import { localName } from '@/lib/format';
import type { Branch } from '@/lib/types';

/** Super Admin only: switch between branches seamlessly or view the consolidated "all branches" scope. */
export default function BranchSelector() {
  const { user, setScope, version } = useAuth(); const { t, lang } = useI18n();
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => { if (user?.role === 'owner') get<{ branches: Branch[] }>('/api/branches').then((r) => setBranches(r.branches.filter((b) => b.is_active))).catch(() => {}); }, [user?.role, version]);
  if (!user || user.role !== 'owner') {
    return user?.branch ? <span className="hidden rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-semibold text-gold md:inline" title={t('shell.yourBranch')}>{localName(user.branch, lang)}</span> : null;
  }
  return (
    <label className="flex items-center gap-2 text-xs text-navy-300">
      <span className="hidden lg:inline">{t('shell.branch')}</span>
      <select aria-label={t('shell.branch')} value={user.scopeBranch ?? 'ALL'} onChange={(e) => setScope(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)).catch(() => {})}
        className="max-w-[10.5rem] cursor-pointer rounded-lg border border-navy-500 bg-navy-600 px-2.5 py-1.5 text-xs font-semibold text-white focus:border-gold focus:outline-none">
        <option value="ALL">{t('shell.allBranches')}</option>
        {branches.map((b) => <option key={b.id} value={b.id}>{localName(b, lang)}</option>)}
      </select>
    </label>
  );
}
