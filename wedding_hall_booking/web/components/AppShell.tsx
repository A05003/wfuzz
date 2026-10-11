'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { localName } from '@/lib/format';
import LiveClock from './LiveClock';
import LangToggle from './LangToggle';
import BranchSelector from './BranchSelector';
import QuickSearch from './QuickSearch';
import ContractDrawer from './ContractDrawer';
import { Spinner } from './ui';

const OpenCtx = createContext<(id: number) => void>(() => {});
export const useOpenContract = () => useContext(OpenCtx);

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, venue, loading, logout, can } = useAuth(); const { t, lang } = useI18n(); const path = usePathname();
  const [openId, setOpenId] = useState<number | null>(null);
  const open = useCallback((id: number) => setOpenId(id), []);
  if (loading || !user) return <div className="grid min-h-screen place-items-center bg-canvas"><Spinner /></div>;
  const nav = [
    { href: '/dashboard', label: user.role === 'supervisor' ? t('nav.field') : t('nav.dashboard'), show: true },
    { href: '/security', label: t('nav.security'), show: can('audit.read') },
    { href: '/settings', label: t('nav.settings'), show: user.role === 'owner' },
  ].filter((n) => n.show);
  const roleLabel = t(`role.${user.role}`);
  return (
    <OpenCtx.Provider value={open}>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-5 gap-y-2 bg-navy px-4 py-2.5 text-white md:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label={t('nav.dashboard')}>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-xl text-navy">{venue?.logo_text || '♛'}</span>
          <span className="leading-tight"><b className="block text-[15px]">{venue ? (lang === 'ar' ? venue.name_ar : venue.name_en) : ''}</b><small className="text-xs text-navy-300">{t('shell.erp')}</small></span>
        </Link>
        {can('booking.read') ? <div className="order-last flex min-w-[220px] flex-1 basis-full md:order-none md:basis-auto md:max-w-xl md:justify-self-center md:mx-auto"><QuickSearch onOpen={open} /></div> : <div className="flex-1" />}
        <LiveClock />
        <BranchSelector />
        <LangToggle />
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-navy-500 font-bold text-gold" aria-hidden>{user.name.slice(0, 1)}</span>
          <div className="hidden leading-tight sm:block"><b className="block text-[13px]">{user.name}</b><small className="text-[11.5px] text-navy-300">{roleLabel}{user.branch ? ` · ${localName(user.branch, lang)}` : ` · ${t('shell.allBranches')}`}</small></div>
          <button onClick={() => logout()} className="rounded-lg border border-navy-500 px-3 py-1.5 text-xs font-semibold text-navy-200 hover:bg-navy-500">{t('shell.logout')}</button>
        </div>
      </header>
      <nav aria-label={t('nav.aria')} className="flex gap-1 border-b border-ink-line bg-white px-3 md:px-6">
        {nav.map((n) => {
          const active = path === n.href || path === `${n.href}/`;
          return <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={`border-b-[3px] px-4 py-3 text-sm font-semibold transition ${active ? 'border-gold text-navy' : 'border-transparent text-ink-muted hover:text-navy'}`}>{n.label}</Link>;
        })}
      </nav>
      <main className="mx-auto max-w-[1400px] p-4 md:p-6">{children}</main>
      {openId !== null && <ContractDrawer id={openId} onClose={() => setOpenId(null)} />}
    </OpenCtx.Provider>
  );
}
