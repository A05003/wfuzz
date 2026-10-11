'use client';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ToastProvider } from './ui';

function TitleSync() {
  const { venue } = useAuth(); const { lang, t } = useI18n();
  useEffect(() => { document.title = `${venue ? (lang === 'ar' ? venue.name_ar : venue.name_en) : ''} — ${t('shell.erp')}`; }, [venue, lang, t]);
  return null;
}
export default function Providers({ children }: { children: ReactNode }) {
  return <I18nProvider><ToastProvider><AuthProvider><TitleSync />{children}</AuthProvider></ToastProvider></I18nProvider>;
}
