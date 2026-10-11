'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { put } from '@/lib/api';
import { useAction } from '@/lib/useAction';
import { ErrorBox, useToast } from './ui';

/** Profit-split percentages: editable by the Super Admin only; everyone else sees them read-only. */
export default function SplitCard({ split, onSaved }: { split: { rental: number; marketing: number } | null; onSaved: () => void }) {
  const { t } = useI18n(); const { user } = useAuth(); const toast = useToast(); const { run, busy, error } = useAction();
  const owner = user?.role === 'owner';
  const [rental, setRental] = useState(String(split?.rental ?? 60)); const [marketing, setMarketing] = useState(String(split?.marketing ?? 40));
  const sync = (v: string, which: 'r' | 'm') => { const n = Math.min(100, Math.max(0, Number(v) || 0)); if (which === 'r') { setRental(v); setMarketing(String(Math.round((100 - n) * 100) / 100)); } else { setMarketing(v); setRental(String(Math.round((100 - n) * 100) / 100)); } };
  const save = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await put('/api/settings/split', { rental: Number(rental), marketing: Number(marketing) }); toast(t('split.saved')); onSaved(); }); };
  return (
    <section className="card" aria-label={t('split.title')}>
      <h2 className="text-lg font-bold">{t('split.title')}</h2><p className="mt-1 text-xs text-ink-muted">{t('split.note')}</p>
      {!split && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{t('split.notSet')}</p>}
      <form onSubmit={save} className="mt-3 space-y-3"><ErrorBox error={error} />
        <div className="flex gap-3">
          <label className="flex-1"><span className="label">{t('settle.rental')} %</span><input className="input text-lg font-bold" type="number" min="0" max="100" step="0.5" value={rental} disabled={!owner} onChange={(e) => sync(e.target.value, 'r')} /></label>
          <label className="flex-1"><span className="label">{t('settle.marketing')} %</span><input className="input text-lg font-bold" type="number" min="0" max="100" step="0.5" value={marketing} disabled={!owner} onChange={(e) => sync(e.target.value, 'm')} /></label>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-200" aria-hidden><i className="block bg-mint" style={{ width: `${Number(rental) || 0}%` }} /><i className="block bg-gold" style={{ width: `${Number(marketing) || 0}%` }} /></div>
        {owner ? <button className="btn btn-primary w-full" disabled={busy}>{t('split.save')}</button> : <p className="rounded-lg bg-gold-soft px-3 py-2 text-xs text-gold-deep">🔒 {t('split.ownerOnly')}</p>}
      </form>
    </section>
  );
}
