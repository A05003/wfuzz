'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { get, post, put } from '@/lib/api';
import { useAction } from '@/lib/useAction';
import { localName, money } from '@/lib/format';
import type { Branch, Hall, Role, UserRow } from '@/lib/types';
import { ErrorBox, Field, Modal, Spinner, useToast } from './ui';

/* ---------------------------------------------------------------- venue profile (login-page branding) ---------------------------------------------------------------- */
export function VenueForm() {
  const { t } = useI18n(); const toast = useToast(); const { run, busy, error } = useAction(); const { bump } = useAuth();
  const [v, setV] = useState<Record<string, string> | null>(null);
  useEffect(() => { get<{ venue: Record<string, string> }>('/api/venue').then((r) => setV(r.venue)); }, []);
  if (!v) return <Spinner />;
  const set = (k: string, val: string) => setV({ ...v, [k]: val });
  const save = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await put('/api/venue', v); toast(t('common.saved')); bump(); window.location.reload(); }); };
  return (
    <form onSubmit={save} className="card grid max-w-3xl grid-cols-2 gap-3">
      <h3 className="col-span-2 text-lg font-bold">{t('set.venue')}</h3><p className="col-span-2 -mt-2 text-xs text-ink-muted">{t('set.venueHint')}</p><div className="col-span-2"><ErrorBox error={error} /></div>
      <Field label={t('set.nameAr')}><input className="input" value={v.name_ar} onChange={(e) => set('name_ar', e.target.value)} required /></Field>
      <Field label={t('set.nameEn')}><input className="input" dir="ltr" value={v.name_en} onChange={(e) => set('name_en', e.target.value)} required /></Field>
      <Field label={t('set.taglineAr')}><input className="input" value={v.tagline_ar} onChange={(e) => set('tagline_ar', e.target.value)} /></Field>
      <Field label={t('set.taglineEn')}><input className="input" dir="ltr" value={v.tagline_en} onChange={(e) => set('tagline_en', e.target.value)} /></Field>
      <Field label={t('set.logo')}><input className="input" value={v.logo_text} maxLength={4} onChange={(e) => set('logo_text', e.target.value)} /></Field>
      <Field label={t('set.phone')}><input className="input" dir="ltr" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      <div className="col-span-2"><button className="btn btn-primary" disabled={busy}>{t('common.save')}</button></div>
    </form>
  );
}

/* ---------------------------------------------------------------- branches and halls ---------------------------------------------------------------- */
export function BranchesAdmin() {
  const { t, lang } = useI18n(); const toast = useToast(); const { run, busy, error } = useAction(); const { version, bump } = useAuth();
  const [branches, setBranches] = useState<Branch[] | null>(null); const [halls, setHalls] = useState<Hall[]>([]);
  const [b, setB] = useState({ code: '', name_ar: '', name_en: '', city: '', phone: '' });
  const [h, setH] = useState({ branchId: '', name_ar: '', name_en: '', capacity_men: '0', capacity_women: '0', base_price: '0' });
  useEffect(() => { get<{ branches: Branch[] }>('/api/branches').then((r) => setBranches(r.branches)); get<{ halls: Hall[] }>('/api/halls').then((r) => setHalls(r.halls)); }, [version]);
  if (!branches) return <Spinner />;
  const addBranch = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await post('/api/branches', b); setB({ code: '', name_ar: '', name_en: '', city: '', phone: '' }); toast(t('common.saved')); bump(); }); };
  const addHall = (e: React.FormEvent) => { e.preventDefault(); run(async () => { await post('/api/halls', { ...h, branchId: Number(h.branchId), capacity_men: Number(h.capacity_men), capacity_women: Number(h.capacity_women), base_price: Number(h.base_price) }); setH({ ...h, name_ar: '', name_en: '' }); toast(t('common.saved')); bump(); }); };
  const toggle = (x: Branch) => run(async () => { await put(`/api/branches/${x.id}`, { ...x, is_active: !x.is_active }); bump(); });
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ErrorBox error={error} />
      <section className="card"><h3 className="mb-3 text-lg font-bold">{t('set.branches')}</h3>
        <ul className="mb-4 divide-y divide-ink-line text-sm">{branches.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2"><span><b>{localName(x, lang)}</b> <span className="num text-xs text-ink-muted">{x.code}</span> {x.city && <span className="text-xs text-ink-muted">· {x.city}</span>}<br /><small className="text-ink-muted">{halls.filter((hh) => hh.branch_id === x.id).map((hh) => localName(hh, lang)).join('، ') || t('set.noHalls')}</small></span>
          <button className={`btn btn-sm ${x.is_active ? '' : 'btn-danger'}`} onClick={() => toggle(x)}>{x.is_active ? t('set.active') : t('set.inactive')}</button></li>)}</ul>
        <form onSubmit={addBranch} className="grid grid-cols-2 gap-3 rounded-xl border border-dashed border-ink-line p-3"><h4 className="col-span-2 text-sm font-bold">{t('set.addBranch')}</h4>
          <Field label={t('set.code')}><input className="input" dir="ltr" value={b.code} onChange={(e) => setB({ ...b, code: e.target.value })} required maxLength={12} /></Field><Field label={t('set.city')}><input className="input" value={b.city} onChange={(e) => setB({ ...b, city: e.target.value })} /></Field>
          <Field label={t('set.nameAr')}><input className="input" value={b.name_ar} onChange={(e) => setB({ ...b, name_ar: e.target.value })} required /></Field><Field label={t('set.nameEn')}><input className="input" dir="ltr" value={b.name_en} onChange={(e) => setB({ ...b, name_en: e.target.value })} required /></Field>
          <div className="col-span-2"><button className="btn btn-primary" disabled={busy}>＋ {t('set.addBranch')}</button></div></form>
      </section>
      <section className="card"><h3 className="mb-3 text-lg font-bold">{t('set.halls')}</h3>
        <div className="mb-4 overflow-auto rounded-xl border border-ink-line"><table className="w-full"><thead><tr><th className="th">{t('contract.hall')}</th><th className="th">{t('shell.branch')}</th><th className="th text-end">{t('set.capacity')}</th><th className="th text-end">{t('contract.base')}</th></tr></thead>
          <tbody>{halls.map((x) => <tr key={x.id}><td className="td font-semibold">{localName(x, lang)}</td><td className="td">{localName(branches.find((br) => br.id === x.branch_id), lang)}</td><td className="td text-end"><span className="num">{x.capacity_men}/{x.capacity_women}</span></td><td className="td text-end"><span className="num">{money(x.base_price)}</span></td></tr>)}</tbody></table></div>
        <form onSubmit={addHall} className="grid grid-cols-2 gap-3 rounded-xl border border-dashed border-ink-line p-3"><h4 className="col-span-2 text-sm font-bold">{t('set.addHall')}</h4>
          <Field label={t('shell.branch')} className="col-span-2"><select className="input" value={h.branchId} onChange={(e) => setH({ ...h, branchId: e.target.value })} required><option value="" disabled>—</option>{branches.map((x) => <option key={x.id} value={x.id}>{localName(x, lang)}</option>)}</select></Field>
          <Field label={t('set.nameAr')}><input className="input" value={h.name_ar} onChange={(e) => setH({ ...h, name_ar: e.target.value })} required /></Field><Field label={t('set.nameEn')}><input className="input" dir="ltr" value={h.name_en} onChange={(e) => setH({ ...h, name_en: e.target.value })} required /></Field>
          <Field label={t('set.capMen')}><input className="input" type="number" min="0" value={h.capacity_men} onChange={(e) => setH({ ...h, capacity_men: e.target.value })} /></Field><Field label={t('set.capWomen')}><input className="input" type="number" min="0" value={h.capacity_women} onChange={(e) => setH({ ...h, capacity_women: e.target.value })} /></Field>
          <Field label={`${t('contract.base')} (${t('currency')})`}><input className="input" type="number" min="0" value={h.base_price} onChange={(e) => setH({ ...h, base_price: e.target.value })} /></Field>
          <div className="col-span-2"><button className="btn btn-primary" disabled={busy}>＋ {t('set.addHall')}</button></div></form>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- users ---------------------------------------------------------------- */
export function UsersAdmin() {
  const { t, lang } = useI18n(); const { run, busy, error } = useAction(); const { user: me, version, bump } = useAuth(); const toast = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null); const [branches, setBranches] = useState<Branch[]>([]); const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [f, setF] = useState({ username: '', fullName: '', role: 'manager' as Role, branchId: '', email: '', phone: '' });
  useEffect(() => { get<{ users: UserRow[] }>('/api/users').then((r) => setUsers(r.users)); get<{ branches: Branch[] }>('/api/branches').then((r) => setBranches(r.branches.filter((b) => b.is_active))); }, [version]);
  if (!users) return <Spinner />;
  const add = (e: React.FormEvent) => { e.preventDefault(); run(async () => { const r = await post<{ password: string }>('/api/users', { ...f, branchId: f.role === 'owner' ? undefined : Number(f.branchId) }); setCreated({ username: f.username, password: r.password }); setF({ ...f, username: '', fullName: '', email: '', phone: '' }); bump(); }); };
  const toggle = (u: UserRow) => run(async () => { await put(`/api/users/${u.id}`, { fullName: u.full_name, role: u.role, branchId: u.branch_id ?? undefined, email: u.email ?? undefined, phone: u.phone ?? undefined, isActive: !u.is_active }); toast(t('common.saved')); bump(); });
  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <section className="card"><h3 className="mb-3 text-lg font-bold">{t('set.users')}</h3><ErrorBox error={error} />
        <div className="overflow-auto rounded-xl border border-ink-line"><table className="w-full"><thead><tr><th className="th">{t('sec.user')}</th><th className="th">{t('sec.role')}</th><th className="th">{t('shell.branch')}</th><th className="th">{t('set.contact')}</th><th className="th" /></tr></thead>
          <tbody>{users.map((u) => <tr key={u.id} className={u.is_active ? '' : 'opacity-50'}><td className="td"><b>{u.full_name}</b> <span className="text-xs text-ink-muted">@{u.username}</span></td><td className="td">{t(`role.${u.role}`)}</td><td className="td">{u.branch_id ? localName({ name_ar: u.branch_name_ar ?? '', name_en: u.branch_name_en ?? '' }, lang) : t('shell.allBranches')}</td>
            <td className="td text-xs text-ink-muted"><span className="num">{u.email || u.phone}</span></td><td className="td text-end">{u.id !== me?.id && <button className={`btn btn-sm ${u.is_active ? 'btn-danger' : ''}`} onClick={() => toggle(u)}>{u.is_active ? t('set.deactivate') : t('set.activate')}</button>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card"><form onSubmit={add} className="grid grid-cols-2 gap-3"><h3 className="col-span-2 text-lg font-bold">{t('set.addUser')}</h3>
        <Field label={t('login.username')}><input className="input" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required maxLength={40} /></Field><Field label={t('set.fullName')}><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required /></Field>
        <Field label={t('sec.role')}><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(['manager', 'supervisor', 'owner'] as const).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select></Field>
        <Field label={t('shell.branch')}><select className="input" disabled={f.role === 'owner'} required={f.role !== 'owner'} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">{f.role === 'owner' ? t('shell.allBranches') : '—'}</option>{branches.map((b) => <option key={b.id} value={b.id}>{localName(b, lang)}</option>)}</select></Field>
        <Field label={t('login.email')}><input className="input" dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label={t('login.phone')}><input className="input" dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <p className="col-span-2 text-xs text-ink-muted">{t('set.contactHint')}</p><div className="col-span-2"><button className="btn btn-primary" disabled={busy}>＋ {t('set.addUser')}</button></div></form></section>
      {created && <Modal title={t('set.userCreated')} onClose={() => setCreated(null)}><p className="mb-3 text-sm">{t('set.showOnce')}</p><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-canvas p-4 text-sm"><dt className="text-ink-muted">{t('login.username')}</dt><dd><b dir="ltr" className="num">{created.username}</b></dd><dt className="text-ink-muted">{t('login.password')}</dt><dd><b dir="ltr" className="num select-all text-lg">{created.password}</b></dd></dl><button className="btn btn-primary mt-4" onClick={() => setCreated(null)}>{t('common.close')}</button></Modal>}
    </div>
  );
}
