'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

/** Subtle live date & time widget for the top navigation (Gregorian + Hijri). */
export default function LiveClock() {
  const { lang } = useI18n(); const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  if (!now) return <div className="h-10 w-40" aria-hidden />;
  const loc = lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';
  const date = now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hijri = now.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-islamic-umalqura-nu-latn' : 'en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="flex shrink-0 flex-col items-end border-x border-navy-500 px-4 leading-tight" title={`${date} · ${hijri}`}>
      <time dateTime={now.toISOString()} className="num text-xl font-semibold tracking-wide text-gold">{now.toLocaleTimeString('en-GB', { hour12: false })}</time>
      <span className="hidden whitespace-nowrap text-[11.5px] text-navy-300 sm:block">{date}<span className="mx-1.5 opacity-50">·</span>{hijri}</span>
    </div>
  );
}
