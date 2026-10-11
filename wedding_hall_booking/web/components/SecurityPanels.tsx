'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { del, get } from '@/lib/api';
import { fmtDateTime, localName, money } from '@/lib/format';
import type { ActiveSession, AuditEntry, Branch, BranchFinancial, DeletedItem, LoginEntry, SecurityEvent, SecurityOverview } from '@/lib/types';
import { Empty, ErrorBox, Spinner, useToast } from './ui';
import { useAction } from '@/lib/useAction';

/* shared: load a list whenever the data version changes */
function useList<T>(url: string, pick: (r: any) => T[], deps: unknown[] = []) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { version } = useAuth(); const [rows, setRows] = useState<T[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => get(url).then((r) => { setRows(pick(r)); setErr(null); }).catch(setErr), [url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); load(); }, [load, version, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, err, reload: load };
}
function useBranches() {
  const [b, setB] = useState<Branch[]>([]); useEffect(() => { get<{ branches: Branch[] }>('/api/branches').then((r) => setB(r.branches)).catch(() => {}); }, []);
  return b;
}
const Sev = ({ s }: { s: AuditEntry['severity'] }) => { const { t } = useI18n(); const c = s === 'critical' ? 'bg-danger text-white' : s === 'warning' ? 'bg-gold text-navy' : 'bg-gray-200 text-gray-700'; return <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${c}`}>{t(`sev.${s}`)}</span>; };
const TBL = ['bookings', 'booking_services', 'payments', 'event_settlements', 'event_expenses', 'profit_split_settings', 'halls', 'branches', 'users', 'venue_settings'];
const useTable = () => { const { t } = useI18n(); return (n: string) => (TBL.includes(n) ? t(`tbl.${n}`) : n); };

/* ---------------------------------------------------------------- overview ---------------------------------------------------------------- */
export function Overview() {
  const { t } = useI18n(); const { version } = useAuth(); const [o, setO] = useState<SecurityOverview | null>(null); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { get<SecurityOverview>('/api/security/overview').then(setO).catch(setErr); }, [version]);
  if (err) return <ErrorBox error={err} />; if (!o) return <Spinner />;
  const cards: [string, number, 'danger' | 'gold' | 'navy' | 'mint'][] = [
    [t('sec.critical'), o.critical7d, 'danger'], [t('sec.warnings'), o.warnings7d, 'gold'], [t('sec.failed'), o.failedLogins24h, 'danger'], [t('sec.violations'), o.branchViolations7d, 'danger'],
    [t('sec.softDeleted'), o.softDeleted, 'gold'], [t('sec.logins'), o.logins24h, 'mint'], [t('sec.sessions'), o.activeSessions, 'navy'], [t('sec.events'), o.securityEvents7d, 'navy'],
  ];
  const border = { danger: 'border-danger', gold: 'border-gold', navy: 'border-navy', mint: 'border-mint' };
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, n, tone]) => <div key={label} className={`card border-t-[3px] !p-4 ${border[tone]} ${n > 0 && (tone === 'danger') ? 'bg-danger-soft/40' : ''}`}><div className="text-xs text-ink-muted">{label}</div><div className="mt-1 text-3xl font-bold"><span className="num">{n}</span></div></div>)}
    </div>
  );
}

/* ---------------------------------------------------------------- cross-branch financial inspection ---------------------------------------------------------------- */
export function BranchInspection() {
  const { t, lang } = useI18n(); const { rows, err } = useList<BranchFinancial>('/api/security/branches', (r) => r.branches);
  if (err) return <ErrorBox error={err} />; if (!rows) return <Spinner />;
  const tot = (k: keyof BranchFinancial) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const cols: [keyof BranchFinancial, string, boolean][] = [['contracts', t('insp.contracts'), false], ['revenue', t('insp.revenue'), true], ['paid', t('fin.paid'), true], ['outstanding', t('insp.outstanding'), true], ['expenses', t('settle.directExpenses'), true], ['net_profit', t('settle.netProfit'), true], ['settled', t('insp.settled'), false], ['late_settlements', t('insp.late'), false], ['deleted_items', t('insp.deleted'), false], ['flagged_events', t('insp.flagged'), false]];
  return (
    <div className="overflow-auto rounded-xl border border-ink-line bg-white">
      <table className="w-full"><thead><tr><th className="th">{t('shell.branch')}</th>{cols.map(([k, l]) => <th key={k} className="th text-end">{l}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.branch_id}><td className="td font-semibold">{localName(r, lang)}</td>
              {cols.map(([k, , isMoney]) => { const v = Number(r[k]); const warn = (k === 'late_settlements' || k === 'deleted_items' || k === 'flagged_events') && v > 0;
                return <td key={k} className="td text-end"><span className={`num ${warn ? 'rounded-md bg-danger-soft px-1.5 font-bold text-danger' : ''}`}>{isMoney ? money(v) : v}</span></td>; })}</tr>))}
          <tr className="bg-canvas font-bold"><td className="td">{t('insp.total')}</td>{cols.map(([k, , isMoney]) => <td key={k} className="td text-end"><span className="num">{isMoney ? money(tot(k)) : tot(k)}</span></td>)}</tr>
        </tbody></table>
    </div>
  );
}

/* ---------------------------------------------------------------- login history ---------------------------------------------------------------- */
export function LoginHistory() {
  const { t, lang } = useI18n(); const branches = useBranches(); const [failed, setFailed] = useState(false); const [q, setQ] = useState('');
  const { rows, err } = useList<LoginEntry>(`/api/security/logins?limit=300${failed ? '&failed=1' : ''}`, (r) => r.logins, [failed]);
  const shown = useMemo(() => (rows || []).filter((l) => !q.trim() || `${l.username} ${l.full_name ?? ''} ${l.ip_address ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const bName = (id: number | null) => (id == null ? t('shell.allBranches') : localName(branches.find((b) => b.id === id), lang) || `#${id}`);
  if (err) return <ErrorBox error={err} />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3"><input className="input !w-64 !py-1.5" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sec.filterPh')} aria-label={t('sec.filterPh')} />
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[#b42318]" checked={failed} onChange={(e) => setFailed(e.target.checked)} />{t('sec.onlyFailed')}</label></div>
      {!rows ? <Spinner /> : (
        <div className="overflow-auto rounded-xl border border-ink-line bg-white">
          <table className="w-full"><thead><tr><th className="th">{t('sec.time')}</th><th className="th">{t('sec.user')}</th><th className="th">{t('sec.event')}</th><th className="th">{t('sec.result')}</th><th className="th">{t('sec.ip')}</th><th className="th">{t('sec.device')}</th><th className="th">{t('sec.assignedBranch')}</th></tr></thead>
            <tbody>{shown.map((l) => (
              <tr key={l.id} className={l.success ? '' : 'bg-danger-soft/30'}><td className="td">{fmtDateTime(l.timestamp, lang)}</td>
                <td className="td"><b>{l.full_name || l.username}</b>{l.full_name && <span className="ms-1.5 text-xs text-ink-muted">@{l.username}</span>}</td><td className="td">{t(`evt.${l.event_type}`)}</td>
                <td className="td">{l.success ? <span className="rounded-md bg-mint-soft px-2 py-0.5 text-xs font-bold text-mint-deep">{t('sec.ok')}</span> : <span className="rounded-md bg-danger px-2 py-0.5 text-xs font-bold text-white">{t(`fail.${l.failure_reason || 'unknown'}`)}</span>}</td>
                <td className="td"><span className="num">{l.ip_address || '—'}</span></td><td className="td">{l.device_info || '—'}</td><td className="td">{l.user_id ? bName(l.assigned_branch_id) : '—'}{l.requested_branch && l.requested_branch !== String(l.assigned_branch_id) && <span className="ms-1.5 text-xs text-danger">→ {t('sec.asked')} {l.requested_branch === 'ALL' ? t('shell.allBranches') : bName(Number(l.requested_branch))}</span>}</td></tr>))}
              {shown.length === 0 && <tr><td colSpan={7}><Empty>{t('table.empty')}</Empty></td></tr>}</tbody></table>
        </div>)}
    </div>
  );
}

/* ---------------------------------------------------------------- soft-deleted items ---------------------------------------------------------------- */
export function DeletedItems() {
  const { t, lang } = useI18n(); const branches = useBranches(); const tbl = useTable(); const { rows, err } = useList<DeletedItem>('/api/security/deleted?limit=300', (r) => r.items);
  if (err) return <ErrorBox error={err} />; if (!rows) return <Spinner />;
  return (
    <div>
      <p className="mb-3 rounded-xl bg-gold-soft/60 px-4 py-2.5 text-sm text-gold-deep">{t('sec.deletedNote')}</p>
      <div className="overflow-auto rounded-xl border border-ink-line bg-white">
        <table className="w-full"><thead><tr><th className="th">{t('sec.type')}</th><th className="th">{t('contract.number')}</th><th className="th">{t('settle.description')}</th><th className="th text-end">{t('settle.amount')}</th><th className="th">{t('shell.branch')}</th><th className="th">{t('sec.deletedBy')}</th><th className="th">{t('sec.time')}</th></tr></thead>
          <tbody>{rows.map((i) => <tr key={`${i.table_name}-${i.record_id}`} className="bg-gold-soft/20"><td className="td"><span className="rounded-md bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">{tbl(i.table_name)}</span></td><td className="td"><b className="num">{i.contract_number}</b></td><td className="td">{i.description}</td>
            <td className="td text-end"><span className="num">{money(i.amount)}</span></td><td className="td">{localName(branches.find((b) => b.id === Number(i.branch_id)), lang)}</td><td className="td">{i.deleted_by_name || '—'}</td><td className="td">{fmtDateTime(i.deleted_at, lang)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={7}><Empty>{t('sec.noDeleted')}</Empty></td></tr>}</tbody></table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- audit trail ---------------------------------------------------------------- */
function changedKeys(a: unknown, b: unknown): [string, unknown, unknown][] {
  const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>, n = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]));
  return keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => [k, o[k], n[k]]);
}
const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditTrail() {
  const { t, lang } = useI18n(); const branches = useBranches(); const tbl = useTable();
  const [sev, setSev] = useState('flagged'); const [branch, setBranch] = useState(''); const [contract, setContract] = useState(''); const [open, setOpen] = useState<number | null>(null);
  const qs = `/api/audit?limit=300${sev ? `&severity=${sev}` : ''}${branch ? `&branch=${branch}` : ''}${contract.trim() ? `&contract=${encodeURIComponent(contract.trim())}` : ''}`;
  const { rows, err } = useList<AuditEntry>(qs, (r) => r.entries);
  if (err) return <ErrorBox error={err} />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input !w-auto !py-1.5" value={sev} onChange={(e) => setSev(e.target.value)} aria-label={t('sec.severity')}>{['flagged', 'critical', 'warning', 'info', ''].map((s) => <option key={s} value={s}>{s ? t(`sev.${s}`) : t('filter.all')}</option>)}</select>
        <select className="input !w-auto !py-1.5" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={t('shell.branch')}><option value="">{t('shell.allBranches')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{localName(b, lang)}</option>)}</select>
        <input className="input !w-48 !py-1.5" dir="ltr" value={contract} onChange={(e) => setContract(e.target.value)} placeholder="C-2026-01001" aria-label={t('contract.number')} />
        <span className="ms-auto text-xs text-ink-muted">{t('sec.readonly')}</span>
      </div>
      {!rows ? <Spinner /> : (
        <div className="overflow-auto rounded-xl border border-ink-line bg-white">
          <table className="w-full"><thead><tr><th className="th">{t('sec.severity')}</th><th className="th">{t('sec.time')}</th><th className="th">{t('sec.user')}</th><th className="th">{t('sec.action')}</th><th className="th">{t('sec.type')}</th><th className="th">{t('contract.number')}</th><th className="th" /></tr></thead>
            <tbody>{rows.map((a) => (
              <Fragment key={a.id}>
                <tr className={a.severity === 'critical' ? 'bg-danger-soft/40' : a.severity === 'warning' ? 'bg-gold-soft/30' : ''}>
                  <td className="td"><Sev s={a.severity} /></td><td className="td">{fmtDateTime(a.timestamp, lang)}</td><td className="td">{a.user_name}</td><td className="td"><b>{t(`act.${a.action}`)}</b></td>
                  <td className="td">{tbl(a.table_name)} <span className="text-xs text-ink-muted">#{a.record_id}</span></td><td className="td"><span className="num">{a.contract_number || '—'}</span></td>
                  <td className="td text-end"><button className="btn btn-sm" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{t('sec.details')}</button></td></tr>
                {open === a.id && (
                  <tr><td colSpan={7} className="bg-canvas p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div><h4 className="mb-1 text-xs font-bold text-ink-muted">{t('sec.changes')}</h4>
                        <ul className="space-y-1 text-xs">{changedKeys(a.old_value, a.new_value).filter(([k]) => !['updated_at'].includes(k)).map(([k, o, n]) => <li key={k} dir="ltr" className="rounded-md bg-white px-2 py-1 text-start"><b>{k}</b>: <span className="text-danger line-through">{show(o)}</span> → <span className="font-semibold text-mint-deep">{show(n)}</span></li>)}</ul></div>
                      <div className="space-y-2"><div><h4 className="mb-1 text-xs font-bold text-ink-muted">old_value</h4><pre dir="ltr" className="max-h-40 overflow-auto rounded-md bg-white p-2 text-start text-[11px]">{JSON.stringify(a.old_value, null, 1) ?? 'null'}</pre></div>
                        <div><h4 className="mb-1 text-xs font-bold text-ink-muted">new_value</h4><pre dir="ltr" className="max-h-40 overflow-auto rounded-md bg-white p-2 text-start text-[11px]">{JSON.stringify(a.new_value, null, 1) ?? 'null'}</pre></div></div>
                    </div></td></tr>)}
              </Fragment>))}
              {rows.length === 0 && <tr><td colSpan={7}><Empty>{t('table.empty')}</Empty></td></tr>}</tbody></table>
        </div>)}
    </div>
  );
}

/* ---------------------------------------------------------------- sessions + security events ---------------------------------------------------------------- */
export function SessionsAndEvents() {
  const { t, lang } = useI18n(); const toast = useToast(); const { bump } = useAuth(); const { run, error } = useAction();
  const s = useList<ActiveSession>('/api/security/sessions', (r) => r.sessions); const e = useList<SecurityEvent>('/api/security/events?limit=100', (r) => r.events);
  const revoke = (id: number) => { if (window.confirm(t('sec.confirmRevoke'))) run(async () => { await del(`/api/security/sessions/${id}`); toast(t('sec.revoked')); bump(); }); };
  return (
    <div className="space-y-6">
      <ErrorBox error={error || s.err || e.err} />
      <section><h3 className="mb-2 font-bold">{t('sec.activeSessions')}</h3>
        {!s.rows ? <Spinner /> : (
          <div className="overflow-auto rounded-xl border border-ink-line bg-white"><table className="w-full"><thead><tr><th className="th">{t('sec.user')}</th><th className="th">{t('sec.role')}</th><th className="th">{t('sec.ip')}</th><th className="th">{t('sec.device')}</th><th className="th">{t('sec.since')}</th><th className="th">{t('sec.lastSeen')}</th><th className="th" /></tr></thead>
            <tbody>{s.rows.map((x) => <tr key={x.id}><td className="td"><b>{x.full_name}</b> <span className="text-xs text-ink-muted">@{x.username}</span></td><td className="td">{t(`role.${x.role}`)}</td><td className="td"><span className="num">{x.ip_address || '—'}</span></td><td className="td">{x.device_info || '—'}</td><td className="td">{fmtDateTime(x.created_at, lang)}</td><td className="td">{fmtDateTime(x.last_seen_at, lang)}</td>
              <td className="td text-end"><button className="btn btn-danger btn-sm" onClick={() => revoke(x.id)}>{t('sec.revoke')}</button></td></tr>)}</tbody></table></div>)}
      </section>
      <section><h3 className="mb-2 font-bold">{t('sec.eventsTitle')}</h3>
        {!e.rows ? <Spinner /> : (
          <div className="overflow-auto rounded-xl border border-ink-line bg-white"><table className="w-full"><thead><tr><th className="th">{t('sec.time')}</th><th className="th">{t('sec.user')}</th><th className="th">{t('sec.event')}</th><th className="th">{t('sec.path')}</th><th className="th">{t('sec.ip')}</th><th className="th">{t('sec.detail')}</th></tr></thead>
            <tbody>{e.rows.map((x) => <tr key={x.id} className={x.event_type === 'BRANCH_VIOLATION' ? 'bg-danger-soft/30' : ''}><td className="td">{fmtDateTime(x.timestamp, lang)}</td><td className="td">{x.full_name || '—'}</td>
              <td className="td"><span className={`rounded-md px-2 py-0.5 text-xs font-bold ${x.event_type === 'BRANCH_VIOLATION' ? 'bg-danger text-white' : 'bg-gold text-navy'}`}>{t(`sevt.${x.event_type}`)}</span></td><td className="td"><span className="num text-xs">{x.method} {x.path}</span></td><td className="td"><span className="num">{x.ip_address || '—'}</span></td><td className="td text-xs text-ink-muted">{x.detail}</td></tr>)}
              {e.rows.length === 0 && <tr><td colSpan={6}><Empty>{t('table.empty')}</Empty></td></tr>}</tbody></table></div>)}
      </section>
    </div>
  );
}
