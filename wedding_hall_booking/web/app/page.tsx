'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ApiError, get, patch, post } from '@/lib/api';
import { errorText } from '@/components/ui';
import LangToggle from '@/components/LangToggle';

type Mode = 'login' | 'forgot' | 'reset';
interface PublicBranch { id: number; name_ar: string; name_en: string }

/** Professional sign-in screen for ONE specific venue (its name, logo and branches come from the server). */
export default function LoginPage() {
  const { user, loading, venue, refresh } = useAuth(); const { t, lang } = useI18n(); const router = useRouter();
  const [mode, setMode] = useState<Mode>('login'); const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [f, setF] = useState({ username: '', password: '', branch: 'ALL' }); const [show, setShow] = useState(false);
  const [rec, setRec] = useState({ identifier: '', code: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState('');

  useEffect(() => { if (!loading && user) router.replace('/dashboard'); }, [loading, user, router]);
  useEffect(() => { get<{ branches: PublicBranch[] }>('/api/public/branches').then((r) => setBranches(r.branches)).catch(() => {}); }, []);

  const wrap = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setInfo(''); try { await fn(); } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); } };

  const login = (e: React.FormEvent) => { e.preventDefault(); wrap(async () => {
    await post('/api/auth/login', { username: f.username, password: f.password, branch: f.branch });
    await refresh(); await patch('/api/auth/lang', { lang }).catch(() => {});      // the language chosen on this screen becomes the account's preference
    router.replace('/dashboard');
  }); };
  const forgot = (e: React.FormEvent) => { e.preventDefault(); wrap(async () => { await post('/api/auth/forgot', { identifier: rec.identifier }); setMode('reset'); setInfo(t('login.codeSent')); }); };
  const reset = (e: React.FormEvent) => { e.preventDefault(); wrap(async () => {
    if (rec.password !== rec.confirm) throw new ApiError(400, 'PASSWORD_MISMATCH');
    await post('/api/auth/reset', { identifier: rec.identifier, code: rec.code.trim(), password: rec.password });
    setMode('login'); setF((x) => ({ ...x, password: '' })); setRec({ identifier: '', code: '', password: '', confirm: '' }); setInfo(t('login.resetDone'));
  }); };

  const name = venue ? (lang === 'ar' ? venue.name_ar : venue.name_en) : '';
  const tagline = venue ? (lang === 'ar' ? venue.tagline_ar : venue.tagline_en) : '';
  const go = (m: Mode) => { setMode(m); setError(''); setInfo(''); };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <aside className="relative hidden overflow-hidden bg-navy text-white lg:flex lg:flex-col lg:justify-between lg:p-12" aria-hidden={false}>
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #E5AD83 1px, transparent 0)', backgroundSize: '26px 26px' }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -start-40 h-[28rem] w-[28rem] rounded-full bg-gold/10 blur-3xl" />
        <div className="relative flex items-center gap-3"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-gold text-3xl text-navy shadow-lg">{venue?.logo_text || '♛'}</span><span className="text-lg font-semibold text-gold">{t('shell.erp')}</span></div>
        <div className="relative">
          <h1 className="text-4xl font-extrabold leading-tight xl:text-5xl">{name || ' '}</h1>
          <p className="mt-3 max-w-md text-lg text-navy-300">{tagline}</p>
          <ul className="mt-10 space-y-3.5 text-[15px] text-navy-200">
            {['login.f1', 'login.f2', 'login.f3', 'login.f4'].map((k) => <li key={k} className="flex items-start gap-3"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mint text-[11px] font-bold text-navy" aria-hidden>✓</span>{t(k)}</li>)}
          </ul>
        </div>
        <p className="relative text-xs text-navy-300">{t('login.secure')}</p>
      </aside>

      {/* form panel */}
      <main className="relative flex flex-col bg-canvas px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 lg:invisible"><span className="grid h-9 w-9 place-items-center rounded-xl bg-navy text-lg text-gold">{venue?.logo_text || '♛'}</span><b className="text-sm">{name}</b></div>
          <LangToggle onDark={false} />
        </div>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-8">
          <h2 className="text-2xl font-extrabold">{mode === 'login' ? t('login.title') : mode === 'forgot' ? t('login.forgotTitle') : t('login.resetTitle')}</h2>
          <p className="mb-6 mt-1 text-sm text-ink-muted">{mode === 'login' ? t('login.subtitle', { venue: name }) : mode === 'forgot' ? t('login.forgotHint') : t('login.resetHint')}</p>
          {error && <div role="alert" className="mb-4 rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</div>}
          {info && <div role="status" className="mb-4 rounded-xl bg-mint-soft px-4 py-2.5 text-sm text-mint-deep">{info}</div>}

          {mode === 'login' && (
            <form onSubmit={login} className="space-y-4" noValidate={false}>
              <label className="block"><span className="label">{t('login.branch')}</span>
                <select className="input" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
                  <option value="ALL">{t('login.allBranches')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{lang === 'ar' ? b.name_ar : b.name_en}</option>)}</select>
                <span className="mt-1 block text-[11.5px] text-ink-muted">{t('login.branchHint')}</span></label>
              <label className="block"><span className="label">{t('login.username')}</span><input className="input" name="username" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required autoFocus dir="ltr" /></label>
              <label className="block"><span className="label">{t('login.password')}</span>
                <span className="relative block"><input className="input pe-16" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required dir="ltr" />
                  <button type="button" onClick={() => setShow(!show)} aria-pressed={show} className="absolute inset-y-0 end-2 my-auto h-7 rounded-md px-2 text-xs font-semibold text-ink-muted hover:bg-gold-soft">{show ? t('login.hide') : t('login.show')}</button></span></label>
              <button className="btn btn-primary w-full !py-3 text-base" disabled={busy}>{busy ? '…' : t('login.submit')}</button>
              <button type="button" onClick={() => { go('forgot'); setRec((r) => ({ ...r, identifier: f.username.includes('@') ? f.username : r.identifier })); }} className="block w-full text-center text-sm font-semibold text-navy-400 hover:text-navy hover:underline">{t('login.forgot')}</button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={forgot} className="space-y-4">
              <label className="block"><span className="label">{t('login.identifier')}</span><input className="input" dir="ltr" value={rec.identifier} onChange={(e) => setRec({ ...rec, identifier: e.target.value })} required autoFocus placeholder="name@example.com  /  05xxxxxxxx" autoComplete="username" /></label>
              <button className="btn btn-primary w-full !py-3" disabled={busy}>{t('login.sendCode')}</button>
              <div className="flex justify-between text-sm"><button type="button" onClick={() => go('login')} className="font-semibold text-navy-400 hover:underline">← {t('login.back')}</button><button type="button" onClick={() => go('reset')} className="font-semibold text-navy-400 hover:underline">{t('login.haveCode')}</button></div>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={reset} className="space-y-4">
              <label className="block"><span className="label">{t('login.identifier')}</span><input className="input" dir="ltr" value={rec.identifier} onChange={(e) => setRec({ ...rec, identifier: e.target.value })} required autoComplete="username" /></label>
              <label className="block"><span className="label">{t('login.code')}</span><input className="input text-center text-xl font-bold tracking-[.4em]" dir="ltr" inputMode="numeric" pattern="\d{6}" maxLength={6} value={rec.code} onChange={(e) => setRec({ ...rec, code: e.target.value.replace(/\D/g, '') })} required autoFocus autoComplete="one-time-code" /></label>
              <label className="block"><span className="label">{t('login.newPassword')}</span><input className="input" type="password" dir="ltr" value={rec.password} onChange={(e) => setRec({ ...rec, password: e.target.value })} required minLength={8} autoComplete="new-password" /><span className="mt-1 block text-[11.5px] text-ink-muted">{t('login.passwordRule')}</span></label>
              <label className="block"><span className="label">{t('login.confirmPassword')}</span><input className="input" type="password" dir="ltr" value={rec.confirm} onChange={(e) => setRec({ ...rec, confirm: e.target.value })} required autoComplete="new-password" /></label>
              <button className="btn btn-primary w-full !py-3" disabled={busy}>{t('login.reset')}</button>
              <div className="flex justify-between text-sm"><button type="button" onClick={() => go('login')} className="font-semibold text-navy-400 hover:underline">← {t('login.back')}</button><button type="button" onClick={() => go('forgot')} className="font-semibold text-navy-400 hover:underline">{t('login.resend')}</button></div>
            </form>
          )}
        </div>
        <p className="text-center text-xs text-ink-muted lg:hidden">{t('login.secure')}</p>
      </main>
    </div>
  );
}
