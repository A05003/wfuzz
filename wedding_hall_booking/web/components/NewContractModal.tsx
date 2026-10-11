'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { get, post } from '@/lib/api';
import { useAction } from '@/lib/useAction';
import { localName, ymd } from '@/lib/format';
import type { Branch, Hall, Section } from '@/lib/types';
import { ErrorBox, Field, Modal, useToast } from './ui';

export default function NewContractModal({ initialDate, onClose, onDone }: { initialDate?: string; onClose: () => void; onDone: (id: number) => void }) {
  const { t, lang } = useI18n(); const toast = useToast(); const { run, busy, error } = useAction();
  const [halls, setHalls] = useState<Hall[]>([]); const [branches, setBranches] = useState<Branch[]>([]);
  const [f, setF] = useState({ hallId: '', eventDate: initialDate || '', section: 'both' as Section, clientName: '', clientPhone: '', baseAmount: '', discount: '0', deposit: '0', method: 'cash' });
  useEffect(() => {
    get<{ halls: Hall[] }>('/api/halls').then((r) => { const hs = r.halls.filter((h) => h.is_active); setHalls(hs); if (hs[0]) setF((x) => ({ ...x, hallId: String(hs[0].id), baseAmount: String(hs[0].base_price || '') })); }).catch(() => {});
    get<{ branches: Branch[] }>('/api/branches').then((r) => setBranches(r.branches)).catch(() => {});
  }, []);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const onHall = (id: string) => { const h = halls.find((x) => String(x.id) === id); setF((x) => ({ ...x, hallId: id, baseAmount: h && h.base_price ? String(h.base_price) : x.baseAmount })); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => post<{ id: number; contractNumber: string }>('/api/contracts', {
      hallId: Number(f.hallId), eventDate: f.eventDate, section: f.section, clientName: f.clientName, clientPhone: f.clientPhone,
      baseAmount: Number(f.baseAmount), discount: Number(f.discount) || 0, deposit: Number(f.deposit) || 0, method: f.method }));
    if (r) { toast(t('contract.created', { n: r.contractNumber })); onDone(r.id); onClose(); }
  };
  const hallLabel = (h: Hall) => branches.length > 1 ? `${localName(h, lang)} — ${localName(branches.find((b) => b.id === h.branch_id), lang)}` : localName(h, lang);
  return (
    <Modal title={t('contract.new')} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><ErrorBox error={error} /></div>
        <Field label={t('contract.hall')} className="col-span-2"><select className="input" value={f.hallId} onChange={(e) => onHall(e.target.value)} required>{halls.map((h) => <option key={h.id} value={h.id}>{hallLabel(h)}</option>)}</select></Field>
        <Field label={t('contract.client')} className="col-span-2"><input className="input" value={f.clientName} onChange={(e) => set('clientName', e.target.value)} required maxLength={150} /></Field>
        <Field label={t('contract.phone')}><input className="input" dir="ltr" value={f.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} required maxLength={30} inputMode="tel" /></Field>
        <Field label={t('contract.date')}><input className="input" type="date" min={ymd(new Date())} value={f.eventDate} onChange={(e) => set('eventDate', e.target.value)} required /></Field>
        <Field label={t('contract.section')}><select className="input" value={f.section} onChange={(e) => set('section', e.target.value)}>{(['women', 'men', 'both'] as const).map((s) => <option key={s} value={s}>{t(`section.${s}`)}</option>)}</select></Field>
        <Field label={`${t('contract.base')} (${t('currency')})`}><input className="input" type="number" min="0" step="0.01" value={f.baseAmount} onChange={(e) => set('baseAmount', e.target.value)} required /></Field>
        <Field label={`${t('contract.discount')} (${t('currency')})`}><input className="input" type="number" min="0" step="0.01" value={f.discount} onChange={(e) => set('discount', e.target.value)} /></Field>
        <Field label={`${t('contract.deposit')} (${t('currency')})`}><input className="input" type="number" min="0" step="0.01" value={f.deposit} onChange={(e) => set('deposit', e.target.value)} /></Field>
        <Field label={t('receipt.method')}><select className="input" value={f.method} onChange={(e) => set('method', e.target.value)}>{(['cash', 'card', 'transfer'] as const).map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}</select></Field>
        <div className="col-span-2 flex gap-2"><button className="btn btn-primary" disabled={busy || !f.hallId}>{t('contract.save')}</button><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button></div>
      </form>
    </Modal>
  );
}
