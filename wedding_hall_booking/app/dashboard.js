/* Unified dashboard prototype (mock data, in-memory).
   Business rules mirror db/schema_v2.sql so the same behaviour can be wired to the API later. */
'use strict';

const CUR = 'ر.س';
const SECTIONS = { women: 'قسم النساء', men: 'قسم الرجال', both: 'القسمين' };
const STATUS = { confirmed: 'مفتوح', closed: 'مُصفّى', cancelled: 'ملغى' };
const METHODS = { cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل بنكي' };
const CATS = { labor: 'عمالة', cleaning: 'نظافة', consumables: 'مستهلكات', other: 'أخرى' };
const SERVICE_CATALOG = [['كوشة', 2500], ['تنسيق ورد', 3000], ['إضاءة خاصة', 1200], ['ضيافة إضافية', 400], ['زفّة', 1500], ['تصوير', 2200]];
const USERS = { owner: { id: 1, name: 'المالك', label: 'المالك' }, manager: { id: 2, name: 'مدير القصر', label: 'مدير القصر' } };

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const money = (n) => `<span class="num">${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>`;
const moneyText = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/* ---------- state ---------- */
const S = {
  role: 'owner', view: 'dash', filter: 'all', selected: null, tab: 'overview',
  split: { rental: 60, marketing: 40 },
  seq: { contract: 1005, receipt: 7, id: 100 },
  contracts: [], services: [], payments: [], settlements: [], expenses: [], audit: [],
};
const nid = () => ++S.seq.id;
const me = () => USERS[S.role];
const isOwner = () => S.role === 'owner';

function seed() {
  const c = (id, no, client, phone, date, section, base, discount, status) => S.contracts.push({ id, no, client, phone, date, section, base, discount, status, deleted: false });
  c(1, 'C-2026-01001', 'عائلة السالم', '0501112233', today(), 'both', 20000, 0, 'confirmed');
  c(2, 'C-2026-01002', 'شركة النور للتجارة', '0555556677', addDays(-2), 'women', 12000, 500, 'confirmed');
  c(3, 'C-2026-01003', 'عائلة العتيبي', '0540001122', addDays(9), 'men', 9000, 0, 'confirmed');
  c(4, 'C-2026-01004', 'عائلة الحربي', '0533344556', addDays(21), 'both', 26000, 1000, 'confirmed');
  c(5, 'C-2026-01000', 'عائلة القحطاني', '0566677889', addDays(-10), 'both', 22000, 0, 'closed');
  const sv = (cid, name, qty, price) => S.services.push({ id: nid(), cid, name, qty, price, addedAt: addDays(-30), deleted: false });
  const pay = (cid, no, amount, method, note) => S.payments.push({ id: nid(), cid, no, amount, method, note, at: addDays(-20), deleted: false });
  sv(1, 'تنسيق ورد', 1, 3000); pay(1, 'R-2026-000001', 10000, 'transfer', 'عربون');
  sv(2, 'كوشة', 1, 2500); pay(2, 'R-2026-000002', 5000, 'cash', 'عربون');
  pay(3, 'R-2026-000003', 3000, 'card', 'عربون');
  pay(4, 'R-2026-000004', 8000, 'transfer', 'عربون');
  sv(5, 'كوشة', 1, 2500); pay(5, 'R-2026-000005', 24500, 'transfer', 'سداد كامل');
  S.settlements.push({ id: 90, cid: 5, status: 'finalized', rentalPct: 60, marketingPct: 40, override: null, overrideReason: '', finalizedAt: addDays(-10), onDay: true });
  S.expenses.push({ id: 91, sid: 90, cat: 'labor', desc: 'أجور العمال', amount: 3200, deleted: false }, { id: 92, sid: 90, cat: 'cleaning', desc: 'نظافة وتعقيم', amount: 900, deleted: false });
}

/* ---------- derived values (the DB computes these with generated columns + triggers) ---------- */
const live = (arr) => arr.filter((x) => !x.deleted);
const cById = (id) => S.contracts.find((c) => c.id === id);
const cSvc = (c) => live(S.services).filter((s) => s.cid === c.id);
const cPay = (c) => live(S.payments).filter((p) => p.cid === c.id);
const settlementOf = (c) => S.settlements.find((s) => s.cid === c.id && !s.deleted);
function totals(c) {
  const services = round2(sum(cSvc(c), (s) => s.qty * s.price));
  const total = round2(c.base - c.discount + services);
  const paid = round2(sum(cPay(c), (p) => p.amount));
  return { services, total, paid, balance: round2(total - paid) };
}
function settleCalc(s) {
  const c = cById(s.cid);
  const revenue = s.override ?? totals(c).total;
  const expenses = round2(sum(live(S.expenses).filter((e) => e.sid === s.id), (e) => e.amount));
  const net = round2(revenue - expenses);
  const rental = round2(net * s.rentalPct / 100);
  return { revenue, expenses, net, rental, marketing: round2(net - rental) };
}
const isDueToday = (c) => c.status === 'confirmed' && c.date === today();
const isOverdue = (c) => c.status === 'confirmed' && c.date < today();

/* ---------- audit (every change is archived, nothing is deleted) ---------- */
function logAudit(action, table, rec, contractNo, before, after) {
  S.audit.unshift({ id: nid(), at: new Date(), user: me().name, action, table, recId: rec, contractNo, before: before && structuredClone(before), after: after && structuredClone(after) });
}
const TABLE_LABEL = { bookings: 'عقد', booking_services: 'خدمة', payments: 'سند قبض', event_expenses: 'مصروف', event_settlements: 'تصفية', profit_split_settings: 'نسب التوزيع' };

/* ---------- toast / modal / panel ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
function openModal(title, body, mount) {
  $('#modalRoot').innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" data-close aria-label="إغلاق">×</button></div><div class="modal-body">${body}</div></div></div>`;
  const bg = $('.modal-bg'); bg.addEventListener('mousedown', (e) => { if (e.target === bg || e.target.hasAttribute('data-close')) closeModal(); });
  mount && mount($('.modal-body')); const f = $('.modal-body input, .modal-body select'); f && f.focus();
}
const closeModal = () => { $('#modalRoot').innerHTML = ''; };
function fail(msg, id = 'err') { const box = document.getElementById(id); if (box) box.innerHTML = `<div class="err">${esc(msg)}</div>`; else toast(msg); return false; }

/* ---------- live clock ---------- */
function tick() {
  const n = new Date();
  $('#clockTime').textContent = n.toLocaleTimeString('en-GB', { hour12: false });
  $('#clockDate').textContent = n.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#clockHijri').textContent = n.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  const t = today(); if (tick.d && tick.d !== t) render();   // midnight rollover refreshes "due today" flags
  tick.d = t;
}

/* ---------- views ---------- */
function render() {
  const o = isOwner();
  $('#userName').textContent = me().name; $('#avatar').textContent = me().name.slice(0, 1);
  $('#roleSwitch').value = S.role; $('#auditLock').classList.toggle('hidden', o);
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  $('#view').innerHTML = S.view === 'audit' ? auditView() : dashView();
  renderPanel();
}

function dashView() {
  const act = S.contracts.filter((c) => !c.deleted && c.status !== 'cancelled');
  const todayList = act.filter((c) => c.date === today());
  const dueSettle = act.filter((c) => isDueToday(c) || isOverdue(c));
  const outstanding = sum(act.filter((c) => c.status !== 'closed'), (c) => totals(c).balance);
  const profit = sum(S.settlements.filter((s) => s.status === 'finalized' && !s.deleted), (s) => settleCalc(s).net);
  const counts = { all: act.length, today: todayList.length, settle: dueSettle.length, open: act.filter((c) => c.status === 'confirmed' && totals(c).balance > 0).length };
  let rows = act.slice().sort((a, b) => b.date.localeCompare(a.date));
  if (S.filter === 'today') rows = rows.filter((c) => c.date === today());
  if (S.filter === 'settle') rows = rows.filter((c) => isDueToday(c) || isOverdue(c));
  if (S.filter === 'open') rows = rows.filter((c) => c.status === 'confirmed' && totals(c).balance > 0);
  const chip = (k, l) => `<button class="chip ${S.filter === k ? 'active' : ''}" data-filter="${k}">${l}<span class="n">${counts[k]}</span></button>`;
  const o = isOwner();
  return `
  ${dueSettle.length ? `<div class="alert" role="alert"><span>⏰</span><div><b>${dueSettle.length} عقد يحتاج تصفية حساب</b> — يجب إغلاق الحساب بالكامل (سداد المتبقي ثم التصفية) في يوم المناسبة نفسه.</div><button class="btn gold sm" data-filter="settle" style="margin-inline-start:auto">عرضها</button></div>`
    : `<div class="alert ok"><span>✓</span><div>لا توجد تصفيات متأخرة.</div></div>`}
  <section class="kpis" aria-label="مؤشرات">
    <div class="kpi k-navy"><small>فعاليات اليوم</small><b>${todayList.length}<span class="unit">فعالية</span></b></div>
    <div class="kpi k-danger"><small>عقود بانتظار التصفية</small><b>${dueSettle.length}<span class="unit">عقد</span></b></div>
    <div class="kpi k-gold"><small>إجمالي المتبقي على العملاء</small><b>${money(outstanding)}<span class="unit">${CUR}</span></b></div>
    <div class="kpi k-mint"><small>صافي أرباح التصفيات المنجزة</small><b>${money(profit)}<span class="unit">${CUR}</span></b></div>
  </section>
  <div class="layout">
    <section class="card">
      <div class="card-head"><h2>العقود</h2><div class="chips">${chip('all', 'الكل')}${chip('today', 'فعاليات اليوم')}${chip('settle', 'تحتاج تصفية')}${chip('open', 'عليها متبقي')}</div></div>
      <div class="tablewrap"><table>
        <thead><tr><th>رقم العقد</th><th>العميل</th><th>تاريخ المناسبة</th><th>القسم</th><th class="r">الإجمالي</th><th class="r">المدفوع</th><th class="r">المتبقي</th><th>الحالة</th></tr></thead>
        <tbody>${rows.map((c) => { const t = totals(c); return `<tr data-open="${c.id}" tabindex="0" aria-label="فتح العقد ${esc(c.no)}">
          <td><span class="contract-no">${esc(c.no)}</span></td><td>${esc(c.client)}</td>
          <td>${esc(fmtDate(c.date))} ${isDueToday(c) ? '<span class="tag today">اليوم</span>' : isOverdue(c) ? '<span class="tag due">متأخرة</span>' : ''}</td>
          <td><span class="tag ${c.section}">${SECTIONS[c.section]}</span></td>
          <td class="r">${money(t.total)}</td><td class="r">${money(t.paid)}</td>
          <td class="r"><span class="${t.balance > 0 ? 'bal-pos' : 'bal-zero'}">${money(t.balance)}</span></td>
          <td><span class="tag ${c.status}">${STATUS[c.status]}</span></td></tr>`; }).join('') || `<tr><td colspan="8" class="empty">لا توجد عقود</td></tr>`}</tbody>
      </table></div>
    </section>
    <aside class="card splitcfg" aria-label="نسب توزيع الأرباح">
      <h2>نسب توزيع صافي الربح</h2>
      <p class="note">تُطبَّق على التصفيات الجديدة فقط.</p>
      <div class="pct">
        <label>عقد إيجار القاعة %<input id="pctRental" type="number" min="0" max="100" step="0.5" value="${S.split.rental}" ${o ? '' : 'disabled'}></label>
        <label>عقد التسويق والإدارة %<input id="pctMarketing" type="number" min="0" max="100" step="0.5" value="${S.split.marketing}" ${o ? '' : 'disabled'}></label>
      </div>
      ${o ? '<button class="btn navy" data-act="saveSplit" style="width:100%">حفظ النسب</button><div id="splitErr"></div>'
          : '<p class="note"><span class="lockmsg">🔒 للمالك فقط.</span> لا يمكن لمدير القصر تعديل نسب التوزيع.</p>'}
    </aside>
  </div>`;
}

function auditView() {
  if (!isOwner()) return `<div class="lockbox"><div class="big">🔒</div><h2>سجل التدقيق متاح للمالك فقط</h2><p>تُحفظ فيه كل التعديلات والمحذوفات بشكل دائم ولا يمكن حذفه.</p></div>`;
  return `<section class="card"><div class="card-head"><h2>سجل التدقيق (أرشيف دائم)</h2><span class="note">${S.audit.length} حدث — للقراءة فقط، لا يمكن تعديله أو حذفه</span></div>
    ${S.audit.map((a) => `<div class="auditrow">
      <div><div>${a.at.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })}</div><small class="note">${esc(a.user)}</small></div>
      <div><span class="act ${a.action}">${a.action}</span></div>
      <div>${esc(TABLE_LABEL[a.table] || a.table)} <small class="note">#${a.recId}</small><br><span class="contract-no">${esc(a.contractNo || '—')}</span></div>
      <div><details><summary>عرض البيانات الأصلية والجديدة</summary>
        <pre>original_data: ${esc(JSON.stringify(a.before, null, 1) ?? 'null')}</pre><pre>new_data: ${esc(JSON.stringify(a.after, null, 1) ?? 'null')}</pre></details></div>
    </div>`).join('') || '<div class="empty">لا توجد أحداث بعد. جرّب إضافة خدمة أو حذف مصروف.</div>'}</section>`;
}

/* ---------- contract workspace ---------- */
function renderPanel() {
  const c = S.selected && cById(S.selected);
  $('#panel').classList.toggle('hidden', !c); $('#panelShade').classList.toggle('hidden', !c);
  if (!c) { $('#panel').innerHTML = ''; return; }
  const t = totals(c);
  const tabs = { overview: 'نظرة عامة', services: 'الخدمات', receipts: 'سندات القبض', settlement: 'تصفية المناسبة' };
  $('#panel').innerHTML = `
    <div class="panel-head"><div><h2><span class="contract-no">${esc(c.no)}</span><span class="tag ${c.status}">${STATUS[c.status]}</span></h2>
      <small>${esc(c.client)} · ${esc(fmtDate(c.date))} · ${SECTIONS[c.section]}</small></div>
      <button class="x" data-act="closePanel" aria-label="إغلاق">×</button></div>
    <div class="ptabs" role="tablist">${Object.entries(tabs).map(([k, v]) => `<button role="tab" data-tab="${k}" class="${S.tab === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div class="panel-body">
      <div class="fin"><div><small>إجمالي العقد</small><b>${money(t.total)}</b></div><div><small>المدفوع</small><b>${money(t.paid)}</b></div>
        <div class="hl"><small>المتبقي</small><b>${money(t.balance)}</b></div></div>
      ${tabBody(c, t)}
    </div>`;
}
function tabBody(c, t) {
  if (S.tab === 'services') return servicesTab(c, t);
  if (S.tab === 'receipts') return receiptsTab(c, t);
  if (S.tab === 'settlement') return settlementTab(c, t);
  const due = isDueToday(c);
  return `<dl class="kv"><dt>رقم العقد</dt><dd><span class="contract-no">${esc(c.no)}</span></dd><dt>العميل</dt><dd>${esc(c.client)} — <span class="num">${esc(c.phone)}</span></dd>
    <dt>تاريخ المناسبة</dt><dd>${esc(fmtDate(c.date))}</dd><dt>القسم</dt><dd>${SECTIONS[c.section]}</dd>
    <dt>قيمة القاعة</dt><dd>${money(c.base)} ${CUR}</dd><dt>الخصم</dt><dd>${money(c.discount)} ${CUR}</dd><dt>الخدمات المضافة</dt><dd>${money(t.services)} ${CUR}</dd></dl>
    ${due ? `<div class="alert" style="margin-top:14px"><span>⏰</span><div>المناسبة اليوم: ${t.balance > 0 ? `سدّد المتبقي <b>${moneyText(t.balance)} ${CUR}</b> ثم أغلق الحساب من تبويب «تصفية المناسبة».` : 'الحساب مسدَّد؛ أكمل التصفية من تبويب «تصفية المناسبة».'}</div></div>` : ''}`;
}

function canEditContract(c) {
  if (isOwner()) return { ok: true };
  if (c.status !== 'confirmed') return { ok: false, why: `العقد ${STATUS[c.status]} ولا يمكن تعديله إلا من المالك.` };
  if (c.date < today()) return { ok: false, why: 'مرّ يوم المناسبة: لا تُضاف خدمات بعد اليوم المحدد، والمطلوب تصفية الحساب.' };
  return { ok: true };
}

function servicesTab(c) {
  const list = cSvc(c); const can = canEditContract(c);
  return `<div class="sect-title"><h2>الخدمات المرتبطة بالعقد ${esc(c.no)}</h2>
      <button class="btn mint" data-act="addService" ${can.ok ? '' : 'disabled'}>＋ إضافة خدمة</button></div>
    ${can.ok ? '<p class="note" style="margin:0 0 10px">يمكن إضافة خدمات في أي وقت — حتى بعد أشهر من الاتفاق الأولي — وتُحتسب فورًا على العقد نفسه.</p>' : `<div class="locknote">🔒 ${esc(can.why)}</div>`}
    <div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>الخدمة</th><th>الكمية</th><th class="r">السعر</th><th class="r">الإجمالي</th><th>أُضيفت</th><th></th></tr></thead>
    <tbody>${list.map((s) => `<tr style="cursor:default"><td>${esc(s.name)}</td><td><span class="num">${s.qty}</span></td><td class="r">${money(s.price)}</td><td class="r">${money(s.qty * s.price)}</td>
      <td>${esc(fmtDate(s.addedAt))}</td><td class="r">${can.ok ? `<button class="btn sm ghost-danger" data-act="delService" data-id="${s.id}">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد خدمات مضافة</td></tr>'}</tbody></table></div>`;
}

function receiptsTab(c, t) {
  const can = canEditContract(c);
  return `<div class="sect-title"><h2>سندات القبض</h2></div>
    <div class="tablewrap"><table><thead><tr><th>رقم السند</th><th>رقم العقد</th><th>التاريخ</th><th>الطريقة</th><th class="r">المبلغ</th><th></th></tr></thead>
    <tbody>${cPay(c).map((p) => `<tr style="cursor:default"><td><span class="contract-no">${esc(p.no)}</span></td><td><span class="contract-no">${esc(c.no)}</span></td><td>${esc(fmtDate(p.at))}</td><td>${METHODS[p.method]}</td><td class="r">${money(p.amount)}</td>
      <td class="r">${can.ok ? `<button class="btn sm ghost-danger" data-act="delPayment" data-id="${p.id}">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد سندات</td></tr>'}</tbody></table></div>
    ${can.ok ? `<div class="sect-title"><h2>سند قبض جديد</h2></div><div id="err"></div>
      <form class="form" id="payForm"><label>المبلغ (${CUR})<input name="amount" type="number" min="0.01" step="0.01" max="${Math.max(t.balance, 0)}" required value="${t.balance > 0 ? t.balance : ''}"></label>
      <label>طريقة الدفع<select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="full">ملاحظة<input name="note" placeholder="اختياري"></label>
      <div class="full"><button class="btn mint" ${t.balance <= 0 ? 'disabled' : ''}>إصدار السند</button> <span class="note">يُربط تلقائيًا بالعقد ${esc(c.no)}</span></div></form>`
      : `<div class="locknote">🔒 ${esc(can.why)}</div>`}`;
}

function settlementTab(c, t) {
  const s = settlementOf(c);
  if (c.date > today()) return `<div class="lockbox"><div class="big">🗓️</div><h2>تُفتح التصفية يوم المناسبة</h2><p>${esc(fmtDate(c.date))}. حتى ذلك الحين يمكن إضافة الخدمات وتسجيل الدفعات.</p></div>`;
  if (!s) return `<div class="lockbox"><div class="big">🧾</div><h2>لم تُفتح تصفية هذه المناسبة بعد</h2><p>أدخل المصروفات المباشرة (عمالة، نظافة، مستهلكات) ليُحسب صافي الربح وتوزيعه.</p>
    <button class="btn mint" data-act="openSettlement" ${c.status === 'confirmed' ? '' : 'disabled'}>فتح التصفية</button></div>`;
  const k = settleCalc(s); const fin = s.status === 'finalized'; const o = isOwner(); const frozen = fin && !o;
  const exps = live(S.expenses).filter((e) => e.sid === s.id);
  const checks = [[t.balance === 0, `الرصيد المتبقي = 0 (${moneyText(t.balance)} ${CUR})`], [c.date <= today(), 'تم الوصول ليوم المناسبة'], [c.date === today(), 'التصفية في يوم المناسبة نفسه']];
  const canFinal = !fin && checks[0][0] && checks[1][0];
  const pctA = s.rentalPct, pctB = s.marketingPct;
  return `<div class="settle">
    <div>
      <div class="sect-title" style="margin-top:0"><h2>المصروفات المباشرة</h2>${fin ? '<span class="tag closed">نهائية</span>' : '<span class="tag confirmed">مسودة</span>'}</div>
      <div class="tablewrap"><table><thead><tr><th>البند</th><th>البيان</th><th class="r">المبلغ</th><th></th></tr></thead>
      <tbody>${exps.map((e) => `<tr style="cursor:default"><td>${CATS[e.cat]}</td><td>${esc(e.desc)}</td><td class="r">${money(e.amount)}</td>
        <td class="r">${frozen ? '' : `<button class="btn sm ghost-danger" data-act="delExpense" data-id="${e.id}" title="يُنقل إلى سجل التدقيق">حذف</button>`}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">لا توجد مصروفات بعد</td></tr>'}</tbody></table></div>
      ${frozen ? '<div class="locknote">🔒 التصفية نهائية ومجمّدة. التعديل للمالك فقط.</div>' : `<div id="err"></div>
      <form class="form sticky-form" id="expForm"><label>البند<select name="cat">${Object.entries(CATS).map(([k2, v]) => `<option value="${k2}">${v}</option>`).join('')}</select></label>
        <label>المبلغ (${CUR})<input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label class="full">البيان<input name="desc" required placeholder="مثال: أجور 10 عمال × 150"></label>
        <div class="full"><button class="btn navy">＋ إضافة مصروف</button></div></form>`}
    </div>
    <div>
      <div class="sumcard" aria-label="ملخص التصفية">
        <div class="row"><span>إيراد العقد${s.override != null ? ' (معدَّل من المالك)' : ''}</span><b>${moneyText(k.revenue)}</b></div>
        <div class="row"><span>− المصروفات المباشرة</span><b>${moneyText(k.expenses)}</b></div>
        <div class="net ${k.net < 0 ? 'neg' : ''}"><span>صافي الربح</span><b>${moneyText(k.net)} <small style="font-size:13px">${CUR}</small></b></div>
        <div class="bar" aria-hidden="true"><i class="a" style="width:${pctA}%"></i><i class="b" style="width:${pctB}%"></i></div>
        <div class="legend"><div><span><i class="d" style="background:var(--mint)"></i>إيجار القاعة (${pctA}%)</span><b>${moneyText(k.rental)}</b></div>
          <div style="text-align:end"><span><i class="d" style="background:var(--gold)"></i>التسويق والإدارة (${pctB}%)</span><b>${moneyText(k.marketing)}</b></div></div>
      </div>
      <ul class="checklist" aria-label="شروط الإغلاق">${checks.map(([ok, txt]) => `<li><span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</span>${txt}</li>`).join('')}</ul>
      ${fin ? `<div class="locknote" style="background:var(--mint-soft);color:var(--mint-deep)">✓ أُغلق الحساب ${s.onDay ? 'في يوم المناسبة' : '<b>بعد</b> يوم المناسبة'} — ${esc(fmtDate(s.finalizedAt))}</div>`
        : `<button class="btn mint" style="width:100%;margin-top:12px" data-act="finalize" ${canFinal ? '' : 'disabled'}>إغلاق وتصفية الحساب</button>
           ${canFinal ? '' : '<p class="note">لا يمكن الإغلاق قبل سداد المتبقي بالكامل.</p>'}`}
      ${o ? `<div class="ovr"><h3>صلاحيات المالك</h3><div id="errO"></div>
          <form class="form" id="ovrForm"><label>نسبة إيجار القاعة %<input name="rental" type="number" min="0" max="100" step="0.5" value="${s.rentalPct}"></label>
          <label>نسبة التسويق والإدارة %<input name="marketing" type="number" min="0" max="100" step="0.5" value="${s.marketingPct}"></label>
          <label>تجاوز الإيراد (اختياري)<input name="override" type="number" min="0" step="0.01" value="${s.override ?? ''}" placeholder="${moneyText(totals(c).total)}"></label>
          <label>سبب التجاوز<input name="reason" value="${esc(s.overrideReason)}"></label>
          <div class="full"><button class="btn gold">حفظ</button>${fin ? ' <button type="button" class="btn" data-act="reopen">إعادة فتح التصفية</button>' : ''}</div></form></div>`
        : `<div class="locknote">🔒 نسب التوزيع (${pctA}% / ${pctB}%) وتعديل القيم المالية للمالك فقط.</div>`}
    </div></div>`;
}

/* ---------- actions ---------- */
const actions = {
  closePanel() { S.selected = null; render(); },
  saveSplit() {
    const r = +$('#pctRental').value, m = +$('#pctMarketing').value;
    if (!isOwner()) return;
    if (!Number.isFinite(r) || !Number.isFinite(m) || r < 0 || m < 0 || round2(r + m) !== 100) { $('#splitErr').innerHTML = '<div class="err" style="margin-top:8px">يجب أن يكون المجموع 100%</div>'; return; }
    logAudit('UPDATE', 'profit_split_settings', 1, null, S.split, { rental: r, marketing: m });
    S.split = { rental: r, marketing: m }; render(); toast('تم حفظ نسب التوزيع (تُطبَّق على التصفيات الجديدة)');
  },
  addService() {
    const c = cById(S.selected); if (!canEditContract(c).ok) return;
    const t = totals(c);
    openModal(`إضافة خدمة — ${c.no}`, `<div id="err"></div><form class="form" id="svcForm">
      <label class="full">الخدمة<input name="name" list="svcs" required placeholder="اختر أو اكتب اسم الخدمة"><datalist id="svcs">${SERVICE_CATALOG.map(([n]) => `<option>${esc(n)}</option>`).join('')}</datalist></label>
      <label>الكمية<input name="qty" type="number" min="1" step="1" value="1" required></label>
      <label>سعر الوحدة (${CUR})<input name="price" type="number" min="0" step="0.01" required></label>
      <div class="full preview" aria-live="polite"><span>الإجمالي الحالي<b id="pvOld">${moneyText(t.total)}</b></span><span>بعد الإضافة<b id="pvNew">${moneyText(t.total)}</b></span><span>المتبقي الجديد<b id="pvBal">${moneyText(t.balance)}</b></span></div>
      <p class="note full" style="margin:0">ستُربط الخدمة تلقائيًا برقم العقد <b class="contract-no">${esc(c.no)}</b> ويُعاد حساب الإجمالي والمتبقي فورًا.</p>
      <div class="form-actions full"><button class="btn mint">تأكيد الإضافة</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
    (m) => {
      const f = $('#svcForm', m);
      const upd = () => { const add = Math.max(0, (+f.qty.value || 0) * (+f.price.value || 0)); $('#pvNew', m).textContent = moneyText(round2(t.total + add)); $('#pvBal', m).textContent = moneyText(round2(t.balance + add)); };
      f.name.addEventListener('input', () => { const hit = SERVICE_CATALOG.find(([n]) => n === f.name.value); if (hit) { f.price.value = hit[1]; upd(); } });
      f.qty.addEventListener('input', upd); f.price.addEventListener('input', upd);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const g = canEditContract(c); if (!g.ok) return fail(g.why);
        const row = { id: nid(), cid: c.id, name: f.name.value.trim(), qty: +f.qty.value, price: +f.price.value, addedAt: today(), deleted: false };
        if (!row.name || !(row.qty > 0) || !(row.price >= 0)) return fail('بيانات الخدمة غير صالحة');
        S.services.push(row); logAudit('CREATE', 'booking_services', row.id, c.no, null, row);
        closeModal(); render(); toast(`أُضيفت «${row.name}» إلى ${c.no} — الإجمالي ${moneyText(totals(c).total)} ${CUR}`);
      });
    });
  },
  delService(id) { softDelete(S.services, id, 'booking_services', 'تم نقل الخدمة إلى سجل التدقيق'); },
  delPayment(id) { softDelete(S.payments, id, 'payments', 'تم نقل السند إلى سجل التدقيق'); },
  delExpense(id) { softDelete(S.expenses, id, 'event_expenses', 'تم نقل المصروف إلى سجل التدقيق'); },
  openSettlement() {
    const c = cById(S.selected);
    if (c.date > today()) return toast('تُفتح التصفية يوم المناسبة');
    const s = { id: nid(), cid: c.id, status: 'draft', rentalPct: S.split.rental, marketingPct: S.split.marketing, override: null, overrideReason: '', finalizedAt: null, onDay: null, deleted: false };
    S.settlements.push(s); logAudit('CREATE', 'event_settlements', s.id, c.no, null, s); render();
  },
  finalize() {
    const c = cById(S.selected); const s = settlementOf(c); const t = totals(c);
    if (t.balance !== 0) return toast('لا يمكن الإغلاق: يوجد رصيد متبقٍ');
    if (c.date > today()) return toast('لا يمكن الإغلاق قبل يوم المناسبة');
    const before = { ...s, contractStatus: c.status };
    s.status = 'finalized'; s.finalizedAt = today(); s.onDay = c.date === today(); c.status = 'closed';
    logAudit('UPDATE', 'event_settlements', s.id, c.no, before, { ...s, contractStatus: c.status }); render(); toast('تم إغلاق وتصفية الحساب');
  },
  reopen() {
    if (!isOwner()) return; const c = cById(S.selected); const s = settlementOf(c); const before = { ...s };
    s.status = 'draft'; s.finalizedAt = null; s.onDay = null; c.status = 'confirmed'; logAudit('UPDATE', 'event_settlements', s.id, c.no, before, { ...s }); render(); toast('أُعيد فتح التصفية');
  },
};
function softDelete(list, id, table, msg) {
  const row = list.find((x) => x.id === id); if (!row) return;
  const c = cById(row.cid ?? settlementById(row.sid)?.cid);
  const frozenForManager = !isOwner() && (c.status !== 'confirmed' || (table === 'booking_services' && c.date < today()));
  if (frozenForManager) return toast('العقد مجمّد: التعديل للمالك فقط');
  const before = { ...row }; row.deleted = true; logAudit('SOFT_DELETE', table, row.id, c.no, before, { ...row }); render(); toast(msg);
}
const settlementById = (id) => S.settlements.find((s) => s.id === id);

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  const a = t.closest('[data-act]'); if (a && actions[a.dataset.act]) { actions[a.dataset.act](a.dataset.id ? Number(a.dataset.id) : undefined); return; }
  const f = t.closest('[data-filter]'); if (f) { S.filter = f.dataset.filter; render(); return; }
  const v = t.closest('[data-view]'); if (v) { S.view = v.dataset.view; render(); return; }
  const tab = t.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; renderPanel(); return; }
  const row = t.closest('[data-open]'); if (row) { openContract(Number(row.dataset.open)); return; }
  if (t.id === 'panelShade') actions.closePanel();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('.modal-bg')) closeModal(); else if (S.selected) actions.closePanel(); hideResults(); }
  if (e.key === 'Enter' && e.target.matches('tr[data-open]')) openContract(Number(e.target.dataset.open));
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
});
document.addEventListener('submit', (e) => {
  const f = e.target; const c = S.selected && cById(S.selected);
  if (f.id === 'payForm') {
    e.preventDefault(); const g = canEditContract(c); if (!g.ok) return fail(g.why);
    const amt = round2(+f.amount.value); const bal = totals(c).balance;
    if (!(amt > 0)) return fail('المبلغ غير صالح');
    if (amt > bal) return fail(`المبلغ أكبر من المتبقي (${moneyText(bal)} ${CUR})`);
    const p = { id: nid(), cid: c.id, no: `R-2026-${String(S.seq.receipt++).padStart(6, '0')}`, amount: amt, method: f.method.value, note: f.note.value.trim(), at: today(), deleted: false };
    S.payments.push(p); logAudit('CREATE', 'payments', p.id, c.no, null, p); render(); toast(`صدر السند ${p.no} على العقد ${c.no}`);
  }
  if (f.id === 'expForm') {
    e.preventDefault(); const s = settlementOf(c); if (s.status === 'finalized' && !isOwner()) return fail('التصفية نهائية ومجمّدة');
    const amt = round2(+f.amount.value); if (!(amt > 0) || !f.desc.value.trim()) return fail('أدخل البيان ومبلغًا صحيحًا');
    const x = { id: nid(), sid: s.id, cat: f.cat.value, desc: f.desc.value.trim(), amount: amt, deleted: false };
    S.expenses.push(x); logAudit('CREATE', 'event_expenses', x.id, c.no, null, x); render();
  }
  if (f.id === 'ovrForm') {
    e.preventDefault(); if (!isOwner()) return fail('للمالك فقط', 'errO'); const s = settlementOf(c);
    const r = +f.rental.value, m = +f.marketing.value, ov = f.override.value === '' ? null : +f.override.value;
    if (!(r >= 0 && m >= 0) || round2(r + m) !== 100) return fail('يجب أن يكون مجموع النسب 100%', 'errO');
    if (ov != null && (!(ov >= 0) || !f.reason.value.trim())) return fail('تجاوز الإيراد يتطلب مبلغًا صحيحًا وسببًا', 'errO');
    const before = { ...s }; Object.assign(s, { rentalPct: r, marketingPct: m, override: ov, overrideReason: ov == null ? '' : f.reason.value.trim() });
    logAudit('UPDATE', 'event_settlements', s.id, c.no, before, { ...s }); render(); toast('تم حفظ تعديلات المالك');
  }
});

function openContract(id, tab = 'overview') { S.selected = id; S.tab = tab; hideResults(); renderPanel(); }

/* ---------- quick search ---------- */
let hits = [], hi = -1;
function search(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  return S.contracts.filter((c) => !c.deleted && (c.no.toLowerCase().includes(q) || c.client.toLowerCase().includes(q) || c.phone.includes(q))).slice(0, 8);
}
function showResults() {
  const box = $('#results'); const q = $('#q').value; hits = search(q); hi = hits.length ? 0 : -1;
  if (!q.trim()) return hideResults();
  box.classList.remove('hidden'); $('#q').setAttribute('aria-expanded', 'true');
  box.innerHTML = hits.map((c, i) => `<li role="option" data-hit="${c.id}" aria-selected="${i === hi}"><span><span class="contract-no">${esc(c.no)}</span> — ${esc(c.client)}</span><small>${esc(fmtDate(c.date))} · ${STATUS[c.status]}</small></li>`).join('') || '<li class="none">لا توجد نتائج</li>';
}
function hideResults() { $('#results').classList.add('hidden'); $('#q').setAttribute('aria-expanded', 'false'); }
$('#q').addEventListener('input', showResults);
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!hits.length) return; hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; document.querySelectorAll('#results li').forEach((li, i) => li.setAttribute('aria-selected', i === hi)); }
  if (e.key === 'Enter' && hits[hi]) { openContract(hits[hi].id); $('#q').value = ''; $('#q').blur(); }
});
$('#results').addEventListener('mousedown', (e) => { const li = e.target.closest('[data-hit]'); if (li) { e.preventDefault(); openContract(Number(li.dataset.hit)); $('#q').value = ''; } });
$('#q').addEventListener('blur', () => setTimeout(hideResults, 120));
$('#roleSwitch').addEventListener('change', (e) => { S.role = e.target.value; render(); toast(`تم التبديل إلى: ${me().label}`); });

seed(); render(); tick(); setInterval(tick, 1000);
