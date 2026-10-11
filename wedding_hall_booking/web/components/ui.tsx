'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import type { Contract, Section } from '@/lib/types';

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, wide = false, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const { t } = useI18n(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey); return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-navy/55 p-3 backdrop-blur-[1px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between bg-navy px-5 py-3.5 text-white">
          <h2 className="text-base font-bold">{title}</h2>
          <button data-close type="button" onClick={onClose} aria-label={t('common.close')} className="grid h-8 w-8 place-items-center rounded-full bg-navy-500 text-lg leading-none hover:bg-navy-400">×</button>
        </div>
        <div className="overflow-auto p-5">{children}</div>
        {footer && <div className="flex gap-2 border-t border-ink-line bg-canvas px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState(''); const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 3200); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className={`pointer-events-none fixed bottom-6 start-1/2 z-[120] max-w-[90vw] -translate-x-1/2 rounded-xl border border-gold bg-navy px-5 py-2.5 text-sm text-white shadow-xl transition-opacity rtl:translate-x-1/2 ${msg ? 'opacity-100' : 'opacity-0'}`}>{msg}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- small pieces ---------- */
export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n(); if (!error) return null;
  const code = error instanceof ApiError ? error.code : 'INTERNAL';
  const text = t(`err.${code}`); const msg = text === `err.${code}` ? t('err.INTERNAL') : text;
  return <div role="alert" className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</div>;
}
export function errorText(t: (k: string) => string, e: unknown) {
  const code = e instanceof ApiError ? e.code : 'INTERNAL'; const s = t(`err.${code}`); return s === `err.${code}` ? t('err.INTERNAL') : s;
}

const SECTION_STYLE: Record<Section, string> = { women: 'bg-pink-100 text-pink-800', men: 'bg-blue-100 text-blue-800', both: 'bg-violet-100 text-violet-800' };
export function SectionBadge({ section }: { section: Section }) { const { t } = useI18n(); return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SECTION_STYLE[section]}`}>{t(`section.${section}`)}</span>; }
export function StatusBadge({ c }: { c: Pick<Contract, 'status' | 'settlement_overdue' | 'settlement_due_today'> }) {
  const { t } = useI18n();
  const cls = c.status === 'closed' ? 'bg-mint-soft text-mint-deep' : c.status === 'cancelled' ? 'bg-gray-200 text-gray-600' : c.settlement_overdue ? 'bg-danger-soft text-danger' : c.settlement_due_today ? 'bg-navy text-gold' : 'bg-gold-soft text-gold-deep';
  const label = c.status === 'confirmed' && c.settlement_overdue ? t('status.overdue') : c.status === 'confirmed' && c.settlement_due_today ? t('status.today') : t(`status.${c.status}`);
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}
export function Spinner() { return <div className="p-8 text-center text-sm text-ink-muted" role="status">…</div>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="p-8 text-center text-sm text-ink-muted">{children}</div>; }
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>;
}
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink-line bg-white px-3">
      {tabs.map((x) => (
        <button key={x.id} role="tab" aria-selected={value === x.id} onClick={() => onChange(x.id)}
          className={`whitespace-nowrap border-b-[3px] px-4 py-3 text-sm font-semibold transition ${value === x.id ? 'border-gold text-navy' : 'border-transparent text-ink-muted hover:text-navy'}`}>{x.label}</button>
      ))}
    </div>
  );
}
export function Stat({ label, value, tone = 'default', strong = false }: { label: string; value: ReactNode; tone?: 'default' | 'danger' | 'ok' | 'dark'; strong?: boolean }) {
  const cls = tone === 'dark' ? 'bg-navy text-white' : 'bg-white';
  const vcls = tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-mint-deep' : tone === 'dark' ? 'text-gold' : '';
  return <div className={`rounded-xl px-4 py-3 shadow-card ${cls}`}><div className={`text-xs ${tone === 'dark' ? 'text-navy-300' : 'text-ink-muted'}`}>{label}</div><div className={`${strong ? 'text-2xl' : 'text-xl'} font-bold ${vcls}`}>{value}</div></div>;
}
