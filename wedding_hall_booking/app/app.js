/* نظام إدارة قصر الأفراح - واجهة أمامية بدون اعتماديات، البيانات في localStorage */
'use strict';

const CURRENCY = 'ر.س';
const STORE_KEY = 'qasr_v1';
const USER_KEY = 'qasr_user';
const SECTIONS = { women: 'قسم النساء', men: 'قسم الرجال', both: 'القسمين' };
const PR_STATUS = { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', ordered: 'تم الطلب' };
const PO_STATUS = { ordered: 'تم الطلب', received: 'تم الاستلام' };
const METHODS = { cash: 'نقدًا', card: 'شبكة', transfer: 'تحويل بنكي' };

/* ---------- data layer ---------- */
function seed() {
  const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
  return {
    seq: { booking: 1004, pr: 3, po: 1 },
    bookings: [
      { id: 1, code: 'B-1001', date: d(3), section: 'women', client: 'عائلة السالم', phone: '0501112233', amount: 18000, services: [{ name: 'كوشة', price: 2500 }], payments: [{ no: 'R-1', date: d(-20), amount: 6000, method: 'cash', note: 'عربون' }], status: 'active' },
      { id: 2, code: 'B-1002', date: d(3), section: 'men', client: 'عائلة السالم', phone: '0501112233', amount: 12000, services: [], payments: [{ no: 'R-2', date: d(-20), amount: 12000, method: 'transfer', note: '' }], status: 'active' },
      { id: 3, code: 'B-1003', date: d(10), section: 'both', client: 'شركة النور', phone: '0555556677', amount: 35000, services: [{ name: 'تنسيق ورد', price: 3000 }], payments: [{ no: 'R-3', date: d(-5), amount: 10000, method: 'card', note: 'عربون' }], status: 'active' },
    ],
    receiptSeq: 3,
    inventory: [
      { id: 1, name: 'كراسي', unit: 'قطعة', qty: 600, min: 400 },
      { id: 2, name: 'مفارش طاولات', unit: 'قطعة', qty: 45, min: 60 },
      { id: 3, name: 'مياه شرب', unit: 'كرتون', qty: 120, min: 80 },
      { id: 4, name: 'ورد صناعي', unit: 'حزمة', qty: 30, min: 20 },
    ],
    requests: [
      { id: 1, code: 'PR-1', itemId: 2, qty: 40, note: 'نقص مفارش', status: 'pending', date: d(-1) },
      { id: 2, code: 'PR-2', itemId: 3, qty: 50, note: '', status: 'approved', date: d(-2) },
    ],
    orders: [],
  };
}
let db;
function load() {
  try { db = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { db = null; }
  if (!db || !db.bookings) { db = seed(); save(); }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* storage unavailable */ } }

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

/* منع الحجز المزدوج: نفس اليوم مع تداخل الأقسام (القسمين يتعارض مع أي قسم) */
function findConflict(date, section, excludeId) {
  return db.bookings.find((b) => b.id !== excludeId && b.status !== 'cancelled' && b.date === date &&
    (b.section === 'both' || section === 'both' || b.section === section));
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
      { title: 'تعديل / طباعة', html: (b) => `<button class="btn sm" data-act="edit" data-id="${b.id}">✏️ تعديل</button> <button class="btn sm" data-act="print" data-id="${b.id}">🖨️ طباعة</button>` },
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
      <div class="toolbar"><button class="btn primary" data-act="new">＋ طلب جديد</button><button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
      ${gridHTML('bookings', cols, rows, footer)}`;
  },

  inventory() {
    const cols = [
      { title: 'إجراء', html: (i) => `<button class="btn sm" data-act="adjust" data-id="${i.id}">± تعديل الكمية</button>` },
      { key: 'name', title: 'الصنف', filter: true, text: (i) => i.name, html: (i) => esc(i.name) },
      { key: 'unit', title: 'الوحدة', filter: true, text: (i) => i.unit, html: (i) => esc(i.unit) },
      { key: 'qty', title: 'الكمية', num: true, filter: true, text: (i) => i.qty, html: (i) => `<span class="${i.qty < i.min ? 'due-pos' : ''}">${i.qty}</span>` },
      { key: 'min', title: 'الحد الأدنى', num: true, text: (i) => i.min, html: (i) => i.min },
    ];
    return `<h1>إدارة المخزون</h1>
      <div class="toolbar"><button class="btn primary" data-act="new">＋ صنف جديد</button><button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
      ${gridHTML('inventory', cols, db.inventory)}`;
  },

  requests() {
    const item = (r) => db.inventory.find((i) => i.id === r.itemId) || { name: '—', unit: '' };
    const cols = [
      { title: 'إجراء', html: (r) => r.status === 'pending' ? `<button class="btn sm ok" data-act="approve" data-id="${r.id}">اعتماد</button> <button class="btn sm bad" data-act="reject" data-id="${r.id}">رفض</button>` : '' },
      { key: 'code', title: 'رقم الطلب', filter: true, text: (r) => r.code, html: (r) => `<b>${esc(r.code)}</b>` },
      { key: 'date', title: 'التاريخ', filter: true, text: (r) => r.date, html: (r) => esc(r.date) },
      { key: 'item', title: 'الصنف', filter: true, text: (r) => item(r).name, html: (r) => esc(item(r).name) },
      { key: 'qty', title: 'الكمية', num: true, text: (r) => r.qty, html: (r) => `${r.qty} ${esc(item(r).unit)}` },
      { key: 'note', title: 'ملاحظات', html: (r) => esc(r.note) },
      { key: 'status', title: 'الحالة', filter: true, options: PR_STATUS, raw: (r) => r.status, html: (r) => `<span class="tag ${r.status}">${PR_STATUS[r.status]}</span>` },
    ];
    return `<h1>طلبات المخزون / المشتريات</h1>
      <div class="toolbar"><button class="btn primary" data-act="new">＋ طلب جديد</button><button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
      ${gridHTML('requests', cols, [...db.requests].reverse())}`;
  },

  orders() {
    const req = (o) => db.requests.find((r) => r.id === o.requestId);
    const item = (o) => { const r = req(o); return r ? db.inventory.find((i) => i.id === r.itemId) : null; };
    const cols = [
      { title: 'إجراء', html: (o) => o.status === 'ordered' ? `<button class="btn sm ok" data-act="receive" data-id="${o.id}">استلام للمخزون</button>` : '' },
      { key: 'code', title: 'رقم الأمر', filter: true, text: (o) => o.code, html: (o) => `<b>${esc(o.code)}</b>` },
      { key: 'req', title: 'الطلب', text: (o) => req(o)?.code || '', html: (o) => esc(req(o)?.code || '—') },
      { key: 'item', title: 'الصنف', filter: true, text: (o) => item(o)?.name || '', html: (o) => `${esc(item(o)?.name || '—')} × ${req(o)?.qty || 0}` },
      { key: 'supplier', title: 'المورد', filter: true, text: (o) => o.supplier, html: (o) => esc(o.supplier) },
      { key: 'cost', title: 'التكلفة', num: true, text: (o) => o.cost, html: (o) => money(o.cost) },
      { key: 'status', title: 'الحالة', filter: true, options: PO_STATUS, raw: (o) => o.status, html: (o) => `<span class="tag ${o.status}">${PO_STATUS[o.status]}</span>` },
    ];
    return `<h1>أمر شراء</h1>
      <div class="toolbar"><button class="btn primary" data-act="new">＋ أمر شراء جديد</button><button class="btn" data-act="refresh">⟳ تحديث Refresh</button></div>
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
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const id = Number(btn.dataset.id); const act = btn.dataset.act;
  if (act === 'refresh') { load(); render(); toast('تم التحديث'); return; }
  const handler = actions[route]?.[act]; if (handler) handler(id);
});

const actions = {
  bookings: {
    edit: (id) => editModal(id),
    print: (id) => printModal(id),
  },
  inventory: {
    new() {
      openModal('صنف جديد', `<form class="form" id="f">
        <label class="full">اسم الصنف<input name="name" required></label>
        <label>الوحدة<input name="unit" required value="قطعة"></label>
        <label>الكمية الحالية<input name="qty" type="number" min="0" value="0" required></label>
        <label>الحد الأدنى<input name="min" type="number" min="0" value="0" required></label>
        <div class="form-actions full"><button class="btn primary">حفظ</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
      (m) => $('#f', m).addEventListener('submit', (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target);
        db.inventory.push({ id: Date.now(), name: f.get('name').trim(), unit: f.get('unit').trim(), qty: +f.get('qty'), min: +f.get('min') });
        save(); closeModal(); render(); toast('تمت إضافة الصنف');
      }));
    },
    adjust(id) {
      const it = db.inventory.find((i) => i.id === id);
      openModal(`تعديل كمية: ${it.name}`, `<form class="form" id="f">
        <label class="full">الكمية الحالية: <b>${it.qty} ${esc(it.unit)}</b></label>
        <label>الإضافة / الخصم (سالب للخصم)<input name="delta" type="number" required value="0"></label>
        <label>الحد الأدنى<input name="min" type="number" min="0" value="${it.min}" required></label>
        <div class="form-actions full"><button class="btn primary">حفظ</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
      (m) => $('#f', m).addEventListener('submit', (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target); const nq = it.qty + (+f.get('delta'));
        if (nq < 0) { toast('الكمية لا يمكن أن تكون سالبة'); return; }
        it.qty = nq; it.min = +f.get('min'); save(); closeModal(); render(); toast('تم تحديث المخزون');
      }));
    },
  },
  requests: {
    new() {
      openModal('طلب مشتريات / مخزون', `<form class="form" id="f">
        <label class="full">الصنف<select name="item">${db.inventory.map((i) => `<option value="${i.id}">${esc(i.name)} (المتوفر ${i.qty})</option>`).join('')}</select></label>
        <label>الكمية المطلوبة<input name="qty" type="number" min="1" required></label>
        <label>ملاحظات<input name="note"></label>
        <div class="form-actions full"><button class="btn primary">إرسال للاعتماد</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
      (m) => $('#f', m).addEventListener('submit', (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target);
        db.requests.push({ id: Date.now(), code: 'PR-' + (++db.seq.pr), itemId: +f.get('item'), qty: +f.get('qty'), note: f.get('note').trim(), status: 'pending', date: today() });
        save(); closeModal(); render(); toast('تم إرسال الطلب للاعتماد');
      }));
    },
    approve(id) { db.requests.find((r) => r.id === id).status = 'approved'; save(); render(); toast('تم اعتماد الطلب'); },
    reject(id) { db.requests.find((r) => r.id === id).status = 'rejected'; save(); render(); toast('تم رفض الطلب'); },
  },
  orders: {
    new() {
      const open = db.requests.filter((r) => r.status === 'approved');
      if (!open.length) { toast('لا توجد طلبات معتمدة لإصدار أمر شراء'); return; }
      openModal('أمر شراء جديد', `<form class="form" id="f">
        <label class="full">الطلب المعتمد<select name="req">${open.map((r) => { const i = db.inventory.find((x) => x.id === r.itemId); return `<option value="${r.id}">${esc(r.code)} — ${esc(i?.name || '')} × ${r.qty}</option>`; }).join('')}</select></label>
        <label>المورد<input name="supplier" required></label>
        <label>التكلفة (${CURRENCY})<input name="cost" type="number" min="0" step="0.01" required></label>
        <div class="form-actions full"><button class="btn primary">إصدار الأمر</button><button type="button" class="btn" data-close>إلغاء</button></div></form>`,
      (m) => $('#f', m).addEventListener('submit', (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target); const rid = +f.get('req');
        db.orders.push({ id: Date.now(), code: 'PO-' + (++db.seq.po), requestId: rid, supplier: f.get('supplier').trim(), cost: +f.get('cost'), status: 'ordered' });
        db.requests.find((r) => r.id === rid).status = 'ordered';
        save(); closeModal(); render(); toast('تم إصدار أمر الشراء');
      }));
    },
    receive(id) {
      const o = db.orders.find((x) => x.id === id); const r = db.requests.find((x) => x.id === o.requestId);
      const it = r && db.inventory.find((i) => i.id === r.itemId);
      if (it) it.qty += r.qty;
      o.status = 'received'; save(); render(); toast('تم الاستلام وتحديث المخزون');
    },
  },
};

/* ---------- bookings: new / edit / print ---------- */
function sectionOptions(sel) { return Object.entries(SECTIONS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join(''); }

function bookingForm(b) {
  const isNew = !b;
  return `<div id="err"></div><form class="form" id="f">
    <label class="full">اسم العميل / الجهة<input name="client" required value="${esc(b?.client)}"></label>
    <label>رقم الجوال<input name="phone" required value="${esc(b?.phone)}"></label>
    <label>تاريخ الحفلة<input name="date" type="date" required value="${esc(b?.date || '')}" ${isNew ? `min="${today()}"` : ''}></label>
    <label>القسم<select name="section">${sectionOptions(b?.section || 'both')}</select></label>
    <label>قيمة العقد (${CURRENCY})<input name="amount" type="number" min="0" step="0.01" required value="${b?.amount ?? ''}"></label>
    ${isNew ? `<label>العربون المستلم (اختياري)<input name="deposit" type="number" min="0" step="0.01" value="0"></label>
    <label>طريقة الدفع<select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>` : ''}
    <div class="form-actions full"><button class="btn primary">${isNew ? 'حفظ الحجز' : 'حفظ التعديلات'}</button><button type="button" class="btn" data-close>إلغاء</button></div>
  </form>`;
}

function readBooking(form, excludeId) {
  const f = new FormData(form); const err = $('#err');
  const data = { client: f.get('client').trim(), phone: f.get('phone').trim(), date: f.get('date'), section: f.get('section'), amount: +f.get('amount') };
  const c = findConflict(data.date, data.section, excludeId);
  if (c) {
    err.innerHTML = `<div class="err">⚠️ لا يمكن الحجز: يوجد حجز <b>${esc(c.code)}</b> (${SECTIONS[c.section]} — ${esc(c.client)}) في نفس اليوم ويتعارض مع هذا القسم.</div>`;
    return null;
  }
  err.innerHTML = ''; return { data, f };
}

actions.bookings.new = () => {
  openModal('طلب حفلة جديد', bookingForm(), (m) => $('#f', m).addEventListener('submit', (ev) => {
    ev.preventDefault();
    const r = readBooking(ev.target); if (!r) return;
    const dep = +r.f.get('deposit');
    if (dep > r.data.amount) { $('#err').innerHTML = '<div class="err">العربون أكبر من قيمة العقد</div>'; return; }
    const b = { id: Date.now(), code: 'B-' + (++db.seq.booking), ...r.data, services: [], payments: [], status: 'active' };
    if (dep > 0) b.payments.push({ no: 'R-' + (++db.receiptSeq), date: today(), amount: dep, method: r.f.get('method'), note: 'عربون' });
    db.bookings.push(b); save(); closeModal(); render(); toast('تم حفظ الحجز: ' + b.code);
  }));
};

function editModal(id, tab = 'pay') {
  const b = db.bookings.find((x) => x.id === id); const t = totals(b);
  const tabs = { pay: 'دفعة جديدة (سند قبض)', svc: 'خدمات تنسيق وديكور', data: 'بيانات العقد' };
  let body = `<div class="summary"><span>العقد: <b>${money(t.invoice)}</b></span><span>المستلم: <b style="color:var(--ok)">${money(t.received)}</b></span><span>المتبقي: <b class="${t.due > 0 ? 'due-pos' : 'due-zero'}">${money(t.due)}</b></span></div>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div>`;
  if (tab === 'pay') {
    body += `<div id="err"></div><form class="form" id="f">
      <label>المبلغ (${CURRENCY})<input name="amount" type="number" min="0.01" step="0.01" max="${Math.max(t.due, 0)}" required value="${t.due > 0 ? t.due : ''}"></label>
      <label>طريقة الدفع<select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="full">ملاحظة<input name="note"></label>
      <div class="form-actions full"><button class="btn primary" ${t.due <= 0 ? 'disabled' : ''}>تسجيل الدفعة</button></div></form>
      ${b.payments.length ? `<table class="mini"><tr><th>السند</th><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th></tr>${b.payments.map((p) => `<tr><td>${esc(p.no)}</td><td>${esc(p.date)}</td><td>${money(p.amount)}</td><td>${METHODS[p.method] || ''}</td></tr>`).join('')}</table>` : ''}`;
  } else if (tab === 'svc') {
    body += `<form class="form" id="f">
      <label>الخدمة<input name="name" list="svcs" required placeholder="كوشة، ورد، إنارة..."></label>
      <label>السعر (${CURRENCY})<input name="price" type="number" min="0" step="0.01" required></label>
      <datalist id="svcs"><option>كوشة</option><option>تنسيق ورد</option><option>إضاءة</option><option>ممر العروس</option><option>طاولات ضيافة</option></datalist>
      <div class="form-actions full"><button class="btn primary">إضافة الخدمة</button></div></form>
      ${b.services.length ? `<table class="mini"><tr><th>الخدمة</th><th>السعر</th><th></th></tr>${b.services.map((s, i) => `<tr><td>${esc(s.name)}</td><td>${money(s.price)}</td><td><button class="btn sm bad" data-del="${i}">حذف</button></td></tr>`).join('')}</table>` : ''}`;
  } else {
    body += bookingForm(b) + `<div class="form-actions"><button type="button" class="btn bad" id="cancelBooking">إلغاء الحجز</button></div>`;
  }
  openModal(`${b.code} — ${b.client}`, body, (m) => {
    m.querySelectorAll('[data-tab]').forEach((x) => x.addEventListener('click', () => editModal(id, x.dataset.tab)));
    const form = $('#f', m);
    if (tab === 'pay') form.addEventListener('submit', (ev) => {
      ev.preventDefault(); const f = new FormData(ev.target); const amt = +f.get('amount');
      if (amt > totals(b).due) { $('#err').innerHTML = '<div class="err">المبلغ أكبر من المتبقي</div>'; return; }
      const p = { no: 'R-' + (++db.receiptSeq), date: today(), amount: amt, method: f.get('method'), note: f.get('note').trim() };
      b.payments.push(p); save(); render(); toast('تم تسجيل السند ' + p.no); editModal(id, 'pay');
    });
    if (tab === 'svc') {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault(); const f = new FormData(ev.target);
        b.services.push({ name: f.get('name').trim(), price: +f.get('price') }); save(); render(); toast('تمت إضافة الخدمة'); editModal(id, 'svc');
      });
      m.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => { b.services.splice(+x.dataset.del, 1); save(); render(); editModal(id, 'svc'); }));
    }
    if (tab === 'data') {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault(); const r = readBooking(ev.target, b.id); if (!r) return;
        Object.assign(b, r.data); save(); closeModal(); render(); toast('تم حفظ التعديلات');
      });
      $('#cancelBooking', m).addEventListener('click', () => {
        if (!confirm('هل أنت متأكد من إلغاء الحجز؟ سيتحرر الموعد.')) return;
        b.status = 'cancelled'; save(); closeModal(); render(); toast('تم إلغاء الحجز');
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
  const t = totals(b); const branch = localStorage.getItem(USER_KEY) ? JSON.parse(localStorage.getItem(USER_KEY)).branch : '';
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
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; } }
function showApp() {
  const u = getUser();
  $('#login').classList.toggle('hidden', !!u); $('#app').classList.toggle('hidden', !u);
  if (!u) return;
  $('#userName').textContent = u.user; $('#branchName').textContent = u.branch; $('#avatar').textContent = u.user.slice(0, 1);
  onHash();
}
$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try { localStorage.setItem(USER_KEY, JSON.stringify({ user: f.get('user').trim(), branch: f.get('branch') })); } catch (err) { /* ignore */ }
  showApp();
});
$('#logout').addEventListener('click', (e) => { e.preventDefault(); try { localStorage.removeItem(USER_KEY); } catch (err) { /* ignore */ } location.hash = ''; showApp(); });

load();
showApp();
