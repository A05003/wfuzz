'use client';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';

/** Arabic / English only. */
export default function LangToggle({ onDark = true }: { onDark?: boolean }) {
  const { lang, setLang } = useI18n(); const { saveLang } = useAuth();
  const base = onDark ? 'border-navy-500 text-navy-300' : 'border-ink-line text-ink-muted';
  const pick = (l: 'ar' | 'en') => { setLang(l); saveLang(l); };
  return (
    <div role="group" aria-label="Language / اللغة" className={`flex overflow-hidden rounded-lg border text-xs font-bold ${base}`}>
      {(['ar', 'en'] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => pick(l)} className={`px-3 py-1.5 transition ${lang === l ? 'bg-gold text-navy' : 'hover:bg-white/10'}`}>{l === 'ar' ? 'العربية' : 'English'}</button>
      ))}
    </div>
  );
}
