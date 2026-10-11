/* نظام إدارة قصر الأفراح - الواجهة الأمامية (تتصل بالخادم عبر REST API) */
'use strict';

const CURRENCY = 'ر.س';
const TOKEN_KEY = 'qasr_token';
const SECTIONS = { women: 'قسم النساء', men: 'قسم الرجال', both: 'القسمين' };
const PR_STATUS = { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', ordered: 'تم الطلب' };
const PO_STATUS = { ordered: 'تم الطلب', received: 'تم الاستلام' };
const METHODS = { cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل بنكي' };

/* ---------- API layer ---------- */
let db = { bookings: [], inventory: [], requests: [], orders: [] };
let me = null; // المستخدم الحالي مع صلاحياته
const can = (perm) => !!me && me.perms.includes(perm);
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage unavailable */ } };

async function api(method, url, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = getToken(); if (t) headers.Authorization = 'Bearer ' + t;
  let res;
  try { res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { throw new Error('تعذر الاتصال بالخادم'); }
  let data = {}; try { data = await res.json(); } catch (e) { /* empty body */ }
  if (res.status === 401 && url !== '/api/login') { forceLogout(); throw new Error(data.error || 'انتهت الجلسة'); }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
  return data;
}
async function reload() { db = await api('GET', '/api/state'); render(); }
/* ينفذ طلبًا ثم يحدّث البيانات؛ يعرض الخطأ داخل النافذة إن وُجد موضعه وإلا كتنبيه */
async function mutate(fn, okMsg) {
  try { const r = await fn(); await reload(); if (okMsg) toast(okMsg); return r || true; }
  catch (e) { const box = $('#err'); if (box) box.innerHTML = `<div class="err">${esc(e.message)}</div>`; else toast(e.message); return false; }
}

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const today = () => new Date().toISOString().slice(0, 10);

function totals(b) {
  const invoice = b.amount + sum(b.services, (s) => s.price);
  const received = sum(b.payments, (p) => p.amount);
  return { invoice, received, due: invoice - received };
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}


/* ---------- modal ---------- */
function openModal(title, body, mount) {
  closeModal();
  $('#modalRoot').innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" data-close aria-label="إغلاق">×</button></div>
    <div class="modal-body">${body}</div></div></div>`;
  const bg = $('.modal-bg');
  bg.addEventListener('mousedown', (e) => { if (e.target === bg || e.target.hasAttribute('data-close')) closeModal(); });
  if (mount) mount($('.modal-body'));
  const first = $('.modal-body input, .modal-body select'); if (first) first.focus();
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- generic filterable grid ---------- */
const filters = {}; // viewKey -> {colKey: value}
function gridHTML(key, cols, rows, footer) {
  const f = filters[key] = filters[key] || {};
  const head = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.title}</th>`).join('');
  const fl = cols.map((c) => {
    if (!c.filter) return '<td></td>';
    if (c.options) return `<td><select data-filter="${c.key}"><option value="">الكل</option>${Object.entries(c.options).map(([k, v]) =>
      `<option value="${k}" ${f[c.key] === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>`;
    return `<td><input data-filter="${c.key}" value="${esc(f[c.key] || '')}" placeholder="بحث"></td>`;
  }).join('');
  const shown = rows.filter((r) => cols.every((c) => {
    const q = (f[c.key] || '').trim().toLowerCase(); if (!q || !c.filter) return true;
    const raw = c.raw ? c.raw(r) : String(c.text(r));
    return c.options ? raw === q : String(raw).toLowerCase().includes(q);
  }));
  const body = shown.length ? shown.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html(r)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="empty">لا توجد بيانات مطابقة</td></tr>`;
  return `<div class="grid-wrap"><table><thead><tr>${head}</tr><tr class="filters">${fl}</tr></thead><tbody>${body}</tbody>${footer ? footer(shown) : ''}</table></div>`;
}
function bindFilters(key, rerender) {
  document.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('input', () => {
      filters[key][el.dataset.filter] = el.value;
      const pos = el.selectionStart; const id = el.dataset.filter;
      rerender();
      const again = document.querySelector(`[data-filter="${id}"]`);
      if (again && again.tagName === 'INPUT') { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
    });
  });
}

/* ---------- views ---------- */
const views = {
  dashboard() {
    const act = db.bookings.filter((b) => b.status !== 'cancelled');
    const t = act.map(totals);
    const upcoming = act.filter((b) => b.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    const low = db.inventory.filter((i) => i.qty < i.min);
    const debtors = act.filter((b) => totals(b).due > 0).sort((a, b) => totals(b).due - totals(a).due).slice(0, 5);
    return `<h1>الرئيسية</h1>
    <div class="cards">
      <div class="card"><small>عدد الحجوزات</small><b>${act.length}</b></div>
      <div class="card"><small>إجمالي العقود</small><b>${money(sum(t, (x) => x.invoice))} ${CURRENCY}</b></div>
      <div class="card"><small>المستلم</small><b style="color:var(--ok)">${money(sum(t, (x) => x.received))} ${CURRENCY}</b></div>
      <div class="card"><small>المتبقي</small><b style="color:var(--bad)">${money(sum(t, (x) => x.due))} ${CURRENCY}</b></div>
    </div>
    <div class="two">
      <div class="card"><h3>الحفلات القادمة</h3>${upcoming.map((b) => `<div class="list-row"><span>${esc(b.date)} · ${esc(b.client)}</span><span class="tag ${b.section}">${SECTIONS[b.section]}</span></div>`).join('') || '<div class="empty">لا توجد حفلات قادمة</div>'}</div>
      <div class="card"><h3>مبالغ متبقية على العملاء</h3>${debtors.map((b) => `<div class="list-row"><span>${esc(b.client)} (${esc(b.code)})</span><b class="due-pos">${money(totals(b).due)}</b></div>`).join('') || '<div class="empty">لا توجد مبالغ متبقية</div>'}</div>
      <div class="card"><h3>تنبيهات المخزون</h3>${low.map((i) => `<div class="list-row"><span>${esc(i.name)}</span><span class="due-pos">${i.qty} / الحد الأدنى ${i.min}</span></div>`).join('') || '<div class="empty">المخزون كافٍ</div>'}</div>
    </div>`;
  },

  bookings() {
    const cols = [
      { title: 'تعديل / طباعة', html: (b) => `${can('booking.write') || can('payment.write') ? `<button class="btn sm" data-act="edit" data-id="${b.id}">✏️ تعديل</button> ` : ''}<button class="btn sm" data-act="print" data-id="${b.id}">🖨️ طباعة</button>` },
      { key: 'code', title: 'الكود / رقم الطلب', filter: true, text: (b) => b.code, html: (b) => `<b>${esc(b.code)}</b>` },
      { key: 'date', title: 'تاريخ الحفلة', filter: true, text: (b) => b.date, html: (b) => esc(b.date) },
      { key: 'section', title: 'القسم (S-Type)', filter: true, options: SECTIONS, raw: (b) => b.section, html: (b) => `<span class="tag ${b.section}">${SECTIONS[b.section]}</span>` },
      { key: 'client', title: 'اسم العميل / الجهة', filter: true, text: (b) => b.client + ' ' + b.phone, html: (b) => esc(b.client) },
      { key: 'invoice', title: 'قيمة العقد', num: true, filter: true, text: (b) => totals(b).invoice, html: (b) => money(totals(b).invoice) },
      { key: 'received', title: 'المبلغ المستلم', num: true, filter: true, text: (b) => totals(b).received, html: (b) => money(totals(b).received) },
      { key: 'due', title: 'المبلغ المتبقي', num: true, filter: true, text: (b) => totals(b).due, html: (b) => { const d = totals(b).due; return `<span class="${d > 0 ? 'due-pos' : 'due-zero'}">${money(d)}</span>`; } },
    ];
    const footer = (rows) => `<tfoot><tr><td colspan="5">الإجمالي (${rows.length})</td><td class="num">${money(sum(rows, (b) => totals(b).invoice))}</td><td class="num">${money(sum(rows, (b) => totals(b).received))}</td><td class="num">${money(sum(rows, (b) => totals(b).due))}</td></tr></tfoot>`;
    const rows = db.bookings.filter((b) => b.status !== 'cancelled').sort((a, b) => b.id - a.id);
    return `<h1>إشعار / طلب حفلة</h1>
      <div class="toolbar">${can('booking.write') ? '<button class="btn primary" data-act="new">＋ طلب جديد</button>' : ''}<button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
      ${gridHTML('bookings', cols, rows, footer)}`;
  },

  inventory() {
    const cols = [
      { title: 'إجراء', html: (i) => can('inventory.write') ? `<button class="btn sm" data-act="adjust" data-id="${i.id}">± تعديل الكمية</button>` : '' },
      { key: 'name', title: 'الصنف', filter: true, text: (i) => i.name, html: (i) => esc(i.name) },
      { key: 'unit', title: 'الوحدة', filter: true, text: (i) => i.unit, html: (i) => esc(i.unit) },
      { key: 'qty', title: 'الكمية', num: true, filter: true, text: (i) => i.qty, html: (i) => `<span class="${i.qty < i.min ? 'due-pos' : ''}">${i.qty}</span>` },
      { key: 'min', title: 'الحد الأدنى', num: true, text: (i) => i.min, html: (i) => i.min },
    ];
    return `<h1>إدارة المخزون</h1>
      <div class="toolbar">${can('inventory.write') ? '<button class="btn primary" data-act="new">＋ صنف جديد</button>' : ''}<button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
      ${gridHTML('inventory', cols, db.inventory)}`;
  },

  requests() {
    const item = (r) => db.inventory.find((i) => i.id === r.itemId) || { name: '—', unit: '' };
    const cols = [
      { title: 'إجراء', html: (r) => r.status === 'pending' && can('request.approve') ? `<button class="btn sm ok" data-act="approve" data-id="${r.id}">اعتماد</button> <button class="btn sm bad" data-act="reject" data-id="${r.id}">رفض</button>` : '' },
      { key: 'code', title: 'رقم الطلب', filter: true, text: (r) => r.code, html: (r) => `<b>${esc(r.code)}</b>` },
      { key: 'date', title: 'التاريخ', filter: true, text: (r) => r.date, html: (r) => esc(r.date) },
      { key: 'item', title: 'الصنف', filter: true, text: (r) => item(r).name, html: (r) => esc(item(r).name) },
      { key: 'qty', title: 'الكمية', num: true, text: (r) => r.qty, html: (r) => `${r.qty} ${esc(item(r).unit)}` },
      { key: 'note', title: 'ملاحظات', html: (r) => esc(r.note) },
      { key: 'status', title: 'الحالة', filter: true, options: PR_STATUS, raw: (r) => r.status, html: (r) => `<span class="tag ${r.status}">${PR_STATUS[r.status]}</span>` },
    ];
    return `<h1>طلبات المخزون / المشتريات</h1>
      <div class="toolbar">${can('request.create') ? '<button class="btn primary" data-act="new">＋ طلب جديد</button>' : ''}<button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
      ${gridHTML('requests', cols, [...db.requests].reverse())}`;
  },

  orders() {
    const req = (o) => db.requests.find((r) => r.id === o.requestId);
    const item = (o) => { const r = req(o); return r ? db.inventory.find((i) => i.id === r.itemId) : null; };
    const cols = [
      { title: 'إجراء', html: (o) => o.status === 'ordered' && can('order.write') ? `<button class="btn sm ok" data-act="receive" data-id="${o.id}">استلام للمخزون</button>` : '' },
      { key: 'code', title: 'رقم الأمر', filter: true, text: (o) => o.code, html: (o) => `<b>${esc(o.code)}</b>` },
      { key: 'req', title: 'الطلب', text: (o) => req(o)?.code || '', html: (o) => esc(req(o)?.code || '—') },
      { key: 'item', title: 'الصنف', filter: true, text: (o) => item(o)?.name || '', html: (o) => `${esc(item(o)?.name || '—')} × ${req(o)?.qty || 0}` },
      { key: 'supplier', title: 'المورد', filter: true, text: (o) => o.supplier, html: (o) => esc(o.supplier) },
      { key: 'cost', title: 'التكلفة', num: true, text: (o) => o.cost, html: (o) => money(o.cost) },
      { key: 'status', title: 'الحالة', filter: true, options: PO_STATUS, raw: (o) => o.status, html: (o) => `<span class="tag ${o.status}">${PO_STATUS[o.status]}</span>` },
    ];
    return `<h1>أمر شراء</h1>
      <div class="toolbar">${can('order.write') ? '<button class="btn primary" data-act="new">＋ أمر شراء جديد</button>' : ''}<button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
      ${gridHTML('orders', cols, [...db.orders].reverse())}`;
  },
};

/* ---------- router ---------- */
let route = 'dashboard';
function render() {
  if (!views[route]) route = 'dashboard';
  $('#view').innerHTML = views[route]();
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  if (['bookings', 'inventory', 'requests', 'orders'].includes(route)) bindFilters(route, render);
  const p = db.requests.filter((r) => r.status === 'pending').length;
  $('#pendingCount').textContent = p; $('#pendingBadge').classList.toggle('zero', p === 0);
}
function onHash() { route = location.hash.slice(1) || 'dashboard'; render(); }
window.addEventListener('hashchange', onHash);

/* ---------- actions (event delegation) ---------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const id = Number(btn.dataset.id); const act = btn.dataset.act;
  if (act === 'refresh') { try { await reload(); toast('تم التحديث'); } catch (err) { toast(err.message); } return; }
  const handler = actions[route]?.[act]; if (handler) handler(id);
});

const formData = (form) => Object.fromEntries(new FormData(form));
/* يربط نموذجًا بدالة إرسال ويمنع النقر المزدوج أثناء الانتظار */
function onSubmit(form, fn) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const b = form.querySelector('button.primary'); if (b) b.disabled = true;
    try { await fn(formData(form)); } finally { if (b && b.isConnected) b.disabled = false; }
  });
}
const FORM_END = '<div class="form-actions full"><button class="btn primary">حفظ</button><button type="button" class="btn" data-close>إلغاء</button></div>';

const actions = {
  bookings: {
    new: () => newBooking(),
    edit: (id) => editModal(id),
    print: (id) => printModal(id),
  },
  inventory: {
    new() {
      openModal('صنف جديد', `<div id="err"></div><form class="form" id="f">
        <label class="full">اسم الصنف<input name="name" required></label>
        <label>الوحدة<input name="unit" required value="قطعة"></label>
        <label>الكمية الحالية<input name="qty" type="number" min="0" step="1" value="0" required></label>
        <label>الحد الأدنى<input name="min" type="number" min="0" step="1" value="0" required></label>${FORM_END}</form>`,
      (m) => onSubmit($('#f', m), async (f) => {
        if (await mutate(() => api('POST', '/api/inventory', { name: f.name, unit: f.unit, qty: +f.qty, min: +f.min }), 'تمت إضافة الصنف')) closeModal();
      }));
    },
    adjust(id) {
      const it = db.inventory.find((i) => i.id === id); if (!it) return;
      openModal(`تعديل كمية: ${it.name}`, `<div id="err"></div><form class="form" id="f">
        <label class="full">الكمية الحالية: <b>${it.qty} ${esc(it.unit)}</b></label>
        <label>الإضافة / الخصم (سالب للخصم)<input name="delta" type="number" step="1" required value="0"></label>
        <label>الحد الأدنى<input name="min" type="number" min="0" step="1" value="${it.min}" required></label>${FORM_END}</form>`,
      (m) => onSubmit($('#f', m), async (f) => {
        if (await mutate(() => api('POST', `/api/inventory/${id}/adjust`, { delta: +f.delta, min: +f.min }), 'تم تحديث المخزون')) closeModal();
      }));
    },
  },
  requests: {
    new() {
      openModal('طلب مشتريات / مخزون', `<div id="err"></div><form class="form" id="f">
        <label class="full">الصنف<select name="item">${db.inventory.map((i) => `<option value="${i.id}">${esc(i.name)} (المتوفر ${i.qty})</option>`).join('')}</select></label>
        <label>الكمية المطلوبة<input name="qty" type="number" min="1" step="1" required></label>
        <label>ملاحظات<input name="note"></label>
        <div class="form-actions full"><button class="btn primary">إرسال للاعتماد</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
      (m) => onSubmit($('#f', m), async (f) => {
        if (await mutate(() => api('POST', '/api/requests', { itemId: +f.item, qty: +f.qty, note: f.note }), 'تم إرسال الطلب للاعتماد')) closeModal();
      }));
    },
    approve: (id) => mutate(() => api('POST', `/api/requests/${id}/approve`), 'تم اعتماد الطلب'),
    reject: (id) => mutate(() => api('POST', `/api/requests/${id}/reject`), 'تم رفض الطلب'),
  },
  orders: {
    new() {
      const open = db.requests.filter((r) => r.status === 'approved');
      if (!open.length) { toast('لا توجد طلبات معتمدة لإصدار أمر شراء'); return; }
      openModal('أمر شراء جديد', `<div id="err"></div><form class="form" id="f">
        <label class="full">الطلب المعتمد<select name="req">${open.map((r) => { const i = db.inventory.find((x) => x.id === r.itemId); return `<option value="${r.id}">${esc(r.code)} — ${esc(i?.name || '')} × ${r.qty}</option>`; }).join('')}</select></label>
        <label>المورد<input name="supplier" required></label>
        <label>التكلفة (${CURRENCY})<input name="cost" type="number" min="0" step="0.01" required></label>
        <div class="form-actions full"><button class="btn primary">إصدار الأمر</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
      (m) => onSubmit($('#f', m), async (f) => {
        if (await mutate(() => api('POST', '/api/orders', { requestId: +f.req, supplier: f.supplier, cost: +f.cost }), 'تم إصدار أمر الشراء')) closeModal();
      }));
    },
    receive: (id) => mutate(() => api('POST', `/api/orders/${id}/receive`), 'تم الاستلام وتحديث المخزون'),
  },
};

/* ---------- bookings: new / edit / print ---------- */
function sectionOptions(sel) { return Object.entries(SECTIONS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join(''); }
const methodOptions = () => Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

function bookingForm(b) {
  const isNew = !b;
  return `<div id="err"></div><form class="form" id="f">
    <label class="full">اسم العميل / الجهة<input name="client" required value="${esc(b?.client)}"></label>
    <label>رقم الجوال<input name="phone" required value="${esc(b?.phone)}"></label>
    <label>تاريخ الحفلة<input name="date" type="date" required value="${esc(b?.date || '')}" ${isNew ? `min="${today()}"` : ''}></label>
    <label>القسم<select name="section">${sectionOptions(b?.section || 'both')}</select></label>
    <label>قيمة العقد (${CURRENCY})<input name="amount" type="number" min="0" step="0.01" required value="${b?.amount ?? ''}"></label>
    ${isNew ? `<label>العربون المستلم (اختياري)<input name="deposit" type="number" min="0" step="0.01" value="0"></label>
    <label>طريقة الدفع<select name="method">${methodOptions()}</select></label>` : ''}
    <div class="form-actions full"><button class="btn primary">${isNew ? 'حفظ الحجز' : 'حفظ التعديلات'}</button><button type="button" class="btn" data-close>إلغاء</button></div>
  </form>`;
}

function newBooking() {
  openModal('طلب حفلة جديد', bookingForm(), (m) => onSubmit($('#f', m), async (f) => {
    const body = { client: f.client, phone: f.phone, date: f.date, section: f.section, amount: +f.amount, deposit: +f.deposit || 0, method: f.method };
    const r = await mutate(() => api('POST', '/api/bookings', body));
    if (r) { closeModal(); toast('تم حفظ الحجز: ' + r.booking.code); }
  }));
}

function editModal(id, tab) {
  const b = db.bookings.find((x) => x.id === id); if (!b) { closeModal(); return; }
  const t = totals(b);
  const tabs = {};
  if (can('payment.write')) tabs.pay = 'دفعة جديدة (سند قبض)';
  if (can('booking.write')) { tabs.svc = 'خدمات تنسيق وديكور'; tabs.data = 'بيانات العقد'; }
  tab = tabs[tab] ? tab : Object.keys(tabs)[0];
  if (!tab) return;
  let body = `<div class="summary"><span>العقد: <b>${money(t.invoice)}</b></span><span>المستلم: <b style="color:var(--ok)">${money(t.received)}</b></span><span>المتبقي: <b class="${t.due > 0 ? 'due-pos' : 'due-zero'}">${money(t.due)}</b></span></div>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div>`;
  if (tab === 'pay') {
    body += `<div id="err"></div><form class="form" id="f">
      <label>المبلغ (${CURRENCY})<input name="amount" type="number" min="0.01" step="0.01" max="${Math.max(t.due, 0)}" required value="${t.due > 0 ? t.due : ''}"></label>
      <label>طريقة الدفع<select name="method">${methodOptions()}</select></label>
      <label class="full">ملاحظة<input name="note"></label>
      <div class="form-actions full"><button class="btn primary" ${t.due <= 0 ? 'disabled' : ''}>تسجيل الدفعة</button></div></form>
      ${b.payments.length ? `<table class="mini"><tr><th>السند</th><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th></tr>${b.payments.map((p) => `<tr><td>${esc(p.no)}</td><td>${esc(p.date)}</td><td>${money(p.amount)}</td><td>${METHODS[p.method] || ''}</td></tr>`).join('')}</table>` : ''}`;
  } else if (tab === 'svc') {
    body += `<div id="err"></div><form class="form" id="f">
      <label>الخدمة<input name="name" list="svcs" required placeholder="كوشة، ورد، إنارة..."></label>
      <label>السعر (${CURRENCY})<input name="price" type="number" min="0" step="0.01" required></label>
      <datalist id="svcs"><option>كوشة</option><option>تنسيق ورد</option><option>إضاءة</option><option>ممر العروس</option><option>طاولات ضيافة</option></datalist>
      <div class="form-actions full"><button class="btn primary">إضافة الخدمة</button></div></form>
      ${b.services.length ? `<table class="mini"><tr><th>الخدمة</th><th>السعر</th><th></th></tr>${b.services.map((s) => `<tr><td>${esc(s.name)}</td><td>${money(s.price)}</td><td><button class="btn sm bad" data-del="${s.id}">حذف</button></td></tr>`).join('')}</table>` : ''}`;
  } else {
    body += bookingForm(b) + `<div class="form-actions"><button type="button" class="btn bad" id="cancelBooking">إلغاء الحجز</button></div>`;
  }
  openModal(`${b.code} — ${b.client}`, body, (m) => {
    m.querySelectorAll('[data-tab]').forEach((x) => x.addEventListener('click', () => editModal(id, x.dataset.tab)));
    const form = $('#f', m);
    if (tab === 'pay') onSubmit(form, async (f) => {
      if (await mutate(() => api('POST', `/api/bookings/${id}/payments`, { amount: +f.amount, method: f.method, note: f.note }), 'تم تسجيل السند')) editModal(id, 'pay');
    });
    if (tab === 'svc') {
      onSubmit(form, async (f) => {
        if (await mutate(() => api('POST', `/api/bookings/${id}/services`, { name: f.name, price: +f.price }), 'تمت إضافة الخدمة')) editModal(id, 'svc');
      });
      m.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', async () => {
        if (await mutate(() => api('DELETE', `/api/bookings/${id}/services/${x.dataset.del}`))) editModal(id, 'svc');
      }));
    }
    if (tab === 'data') {
      onSubmit(form, async (f) => {
        const body = { client: f.client, phone: f.phone, date: f.date, section: f.section, amount: +f.amount };
        if (await mutate(() => api('PUT', `/api/bookings/${id}`, body), 'تم حفظ التعديلات')) closeModal();
      });
      $('#cancelBooking', m).addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من إلغاء الحجز؟ سيتحرر الموعد.')) return;
        if (await mutate(() => api('POST', `/api/bookings/${id}/cancel`), 'تم إلغاء الحجز')) closeModal();
      });
    }
  });
}

/* ---------- printing ---------- */
function printModal(id) {
  const b = db.bookings.find((x) => x.id === id);
  openModal(`طباعة — ${b.code}`, `<form id="f">
    <label class="radio-row"><input type="radio" name="doc" value="contract" checked> العقد الأساسي</label>
    <label class="radio-row"><input type="radio" name="doc" value="receipt"> سند قبض
      <select name="pay" style="margin-right:auto" ${b.payments.length ? '' : 'disabled'}>${b.payments.map((p) => `<option value="${esc(p.no)}">${esc(p.no)} — ${money(p.amount)}</option>`).join('') || '<option>لا توجد دفعات</option>'}</select></label>
    <label class="radio-row"><input type="radio" name="doc" value="statement"> كشف الحساب التجميعي للمناسبة</label>
    <div class="form-actions"><button class="btn primary">🖨️ طباعة</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
  (m) => $('#f', m).addEventListener('submit', (ev) => {
    ev.preventDefault(); const f = new FormData(ev.target); const doc = f.get('doc');
    if (doc === 'receipt' && !b.payments.length) { toast('لا توجد دفعات لطباعة سند قبض'); return; }
    printHTML(buildDoc(b, doc, f.get('pay'))); closeModal();
  }));
}

function buildDoc(b, doc, payNo) {
  const t = totals(b); const branch = me ? me.branch : '';
  const head = (title) => `<div class="h"><h1>قصر الأفراح</h1><div>${esc(branch)}</div><h2>${title}</h2></div>
    <table class="kv"><tr><td>رقم الحجز</td><td>${esc(b.code)}</td><td>التاريخ</td><td>${esc(b.date)}</td></tr>
    <tr><td>العميل / الجهة</td><td>${esc(b.client)}</td><td>الجوال</td><td>${esc(b.phone)}</td></tr>
    <tr><td>القسم</td><td colspan="3">${SECTIONS[b.section]}</td></tr></table>`;
  if (doc === 'receipt') {
    const p = b.payments.find((x) => x.no === payNo) || b.payments[b.payments.length - 1];
    return head('سند قبض') + `<table class="kv"><tr><td>رقم السند</td><td>${esc(p.no)}</td><td>تاريخ السند</td><td>${esc(p.date)}</td></tr>
      <tr><td>المبلغ المستلم</td><td><b>${money(p.amount)} ${CURRENCY}</b></td><td>طريقة الدفع</td><td>${METHODS[p.method] || ''}</td></tr>
      <tr><td>البيان</td><td colspan="3">${esc(p.note || 'دفعة من قيمة عقد حجز القاعة')}</td></tr>
      <tr><td>إجمالي العقد</td><td>${money(t.invoice)}</td><td>المتبقي بعد السند</td><td>${money(t.due)}</td></tr></table>${sign()}`;
  }
  if (doc === 'statement') {
    return head('كشف حساب المناسبة') + `<table class="grid"><tr><th>البيان</th><th>التاريخ</th><th>مدين</th><th>دائن</th></tr>
      <tr><td>قيمة عقد القاعة</td><td>${esc(b.date)}</td><td>${money(b.amount)}</td><td></td></tr>
      ${b.services.map((s) => `<tr><td>${esc(s.name)}</td><td></td><td>${money(s.price)}</td><td></td></tr>`).join('')}
      ${b.payments.map((p) => `<tr><td>سند قبض ${esc(p.no)}</td><td>${esc(p.date)}</td><td></td><td>${money(p.amount)}</td></tr>`).join('')}
      <tr class="t"><td colspan="2">الإجمالي</td><td>${money(t.invoice)}</td><td>${money(t.received)}</td></tr>
      <tr class="t"><td colspan="3">الرصيد المتبقي</td><td>${money(t.due)} ${CURRENCY}</td></tr></table>${sign()}`;
  }
  return head('عقد حجز قاعة') + `<p>تم الاتفاق بين إدارة قصر الأفراح (الطرف الأول) والسيد/ة <b>${esc(b.client)}</b> (الطرف الثاني) على حجز القاعة (<b>${SECTIONS[b.section]}</b>) بتاريخ <b>${esc(b.date)}</b> وفق الشروط التالية:</p>
    <table class="grid"><tr><th>البند</th><th>المبلغ (${CURRENCY})</th></tr>
    <tr><td>قيمة القاعة</td><td>${money(b.amount)}</td></tr>
    ${b.services.map((s) => `<tr><td>${esc(s.name)}</td><td>${money(s.price)}</td></tr>`).join('')}
    <tr class="t"><td>إجمالي العقد</td><td>${money(t.invoice)}</td></tr>
    <tr><td>المدفوع</td><td>${money(t.received)}</td></tr><tr class="t"><td>المتبقي</td><td>${money(t.due)}</td></tr></table>
    <ol><li>يُسدَّد المبلغ المتبقي قبل موعد الحفلة.</li><li>العربون غير مسترد عند إلغاء الحجز من قبل الطرف الثاني.</li><li>يلتزم الطرف الثاني بالمحافظة على محتويات القاعة وبالتعليمات المنظمة للحفلات.</li></ol>${sign()}`;
}
const sign = () => '<div class="sig"><div>توقيع الطرف الأول</div><div>توقيع الطرف الثاني</div></div>';

function printHTML(inner) {
  const css = `body{font-family:Tahoma,Arial,sans-serif;padding:24px;direction:rtl}.h{text-align:center;margin-bottom:14px}.h h1{margin:0}
    table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #888;padding:7px 9px;text-align:right}.kv td:nth-child(odd){background:#f2f2f2;width:18%}
    th{background:#eee}.t td{font-weight:bold;background:#f6f6f6}.sig{display:flex;justify-content:space-around;margin-top:60px}`;
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;width:0;height:0;border:0;';
  document.body.appendChild(fr);
  fr.contentDocument.open();
  fr.contentDocument.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>${css}</style></head><body>${inner}</body></html>`);
  fr.contentDocument.close();
  fr.onload = null;
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 1500); }, 150);
}


/* ---------- login / boot ---------- */
function showLogin(msg) {
  $('#login').classList.remove('hidden'); $('#app').classList.add('hidden');
  $('#loginErr').textContent = msg || '';
}
function forceLogout() { setToken(null); me = null; showLogin('انتهت الجلسة، سجّل الدخول من جديد'); }

async function enter() {
  try {
    me = (await api('GET', '/api/me')).user;
    db = await api('GET', '/api/state');
  } catch (e) { if (getToken()) setToken(null); return showLogin(); }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userName').textContent = me.name; $('#branchName').textContent = me.branch; $('#avatar').textContent = me.name.slice(0, 1);
  onHash();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = formData(e.target); const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/login', { username: f.user, password: f.password });
    setToken(r.token); e.target.reset(); await enter();
  } catch (err) { $('#loginErr').textContent = err.message; }
  finally { btn.disabled = false; }
});
$('#logout').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await api('POST', '/api/logout'); } catch (err) { /* ignore */ }
  setToken(null); me = null; location.hash = ''; showLogin();
});

enter();
