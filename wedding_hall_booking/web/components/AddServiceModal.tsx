'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { get, post } from '@/lib/api';
import { useAction } from '@/lib/useAction';
import { money } from '@/lib/format';
import type { Contract } from '@/lib/types';
import { ErrorBox, Field, Modal, useToast } from './ui';

/** Add an optional service to an existing contract at any time. It binds to the contract number and re-totals instantly. */
export default function AddServiceModal({ contract, onClose, onDone }: { contract: Contract; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const toast = useToast(); const { run, busy, error } = useAction();
  const [catalog, setCatalog] = useState<{ id: number; name: string; default_price: number }[]>([]);
  const [name, setName] = useState(''); const [qty, setQty] = useState('1'); const [price, setPrice] = useState('');
  useEffect(() => { get<{ services: typeof catalog }>('/api/services/catalog').then((r) => setCatalog(r.services)).catch(() => {}); }, []);
  // if the catalogue arrives after the name was typed, still pre-fill its price
  useEffect(() => { const hit = catalog.find((c) => c.name === name); if (hit && price === '') setPrice(String(hit.default_price)); }, [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = Math.max(0, (Number(qty) || 0) * (Number(price) || 0));
  const pickName = (v: string) => { setName(v); const hit = catalog.find((c) => c.name === v); if (hit) setPrice(String(hit.default_price)); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hit = catalog.find((c) => c.name === name.trim());
    const r = await run(() => post<{ contractNumber: string; totals: { total_amount: number; balance_due: number } }>(`/api/contracts/${contract.id}/services`, { name, quantity: Number(qty), unitPrice: Number(price), serviceId: hit?.id }));
    if (r) { toast(t('service.added', { n: r.contractNumber, total: money(r.totals.total_amount) })); onDone(); onClose(); }
  };
  return (
    <Modal title={`${t('service.add')} — ${contract.contract_number}`} onClose={onClose}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><ErrorBox error={error} /></div>
        <Field label={t('service.name')} className="col-span-2">
          <input className="input" list="svc-catalog" value={name} onChange={(e) => pickName(e.target.value)} required maxLength={120} placeholder={t('service.namePh')} />
          <datalist id="svc-catalog">{catalog.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </Field>
        <Field label={t('service.qty')}><input className="input" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
        <Field label={`${t('service.unitPrice')} (${t('currency')})`}><input className="input" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required /></Field>
        <div aria-live="polite" className="col-span-2 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-dashed border-gold bg-gold-soft/40 px-4 py-3 text-sm">
          <span className="text-ink-muted">{t('service.currentTotal')} <b className="num text-ink">{money(contract.total_amount)}</b></span>
          <span className="text-ink-muted">{t('service.newTotal')} <b className="num text-ink">{money(contract.total_amount + add)}</b></span>
          <span className="text-ink-muted">{t('service.newBalance')} <b className="num text-danger">{money(contract.balance_due + add)}</b></span>
        </div>
        <p className="col-span-2 text-xs text-ink-muted">{t('service.bindNote', { n: contract.contract_number })}</p>
        <div className="col-span-2 flex gap-2"><button className="btn btn-mint" disabled={busy}>{t('service.confirm')}</button><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button></div>
      </form>
    </Modal>
  );
}
