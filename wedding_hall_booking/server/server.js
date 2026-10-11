'use strict';
/* خادم REST API + تقديم الواجهة الأمامية. بدون اعتماديات خارجية. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx, nextCounter, hashPassword, verifyPassword, seedIfEmpty } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const STATIC_DIR = path.join(__dirname, '..', 'app');
const SESSION_TTL = 12 * 3600; // seconds
const SECTIONS = ['women', 'men', 'both'];
const METHODS = ['cash', 'card', 'transfer'];

/* الصلاحيات حسب الدور */
const PERMS = {
  'booking.write': ['admin', 'sales'],
  'payment.write': ['admin', 'sales', 'accountant'],
  'inventory.write': ['admin', 'storekeeper'],
  'request.create': ['admin', 'sales', 'storekeeper'],
  'request.approve': ['admin'],
  'order.write': ['admin', 'storekeeper'],
};
const permsOf = (role) => Object.keys(PERMS).filter((p) => PERMS[p].includes(role));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

/* ---------- validation ---------- */
const round2 = (n) => Math.round(n * 100) / 100;
function str(v, name, max = 150) {
  if (typeof v !== 'string' || !v.trim()) throw bad(`الحقل مطلوب: ${name}`);
  if (v.trim().length > max) throw bad(`الحقل طويل جدًا: ${name}`);
  return v.trim();
}
function optStr(v, max = 300) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function num(v, name, { min = 0, max = 1e9, int = false, gt = false } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || (gt ? n <= min : n < min) || n > max || (int && !Number.isInteger(n))) throw bad(`قيمة غير صالحة: ${name}`);
  return int ? n : round2(n);
}
function dateStr(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) throw bad(`تاريخ غير صالح: ${name}`);
  return v;
}
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`قيمة غير صالحة: ${name}`); return v; };
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ---------- queries ---------- */
function bookingRow(b) {
  return {
    id: b.id, code: b.code, date: b.event_date, section: b.section, client: b.client, phone: b.phone,
    amount: b.amount, status: b.status,
    services: db.prepare('SELECT id,name,price FROM booking_services WHERE booking_id=? ORDER BY id').all(b.id),
    payments: db.prepare('SELECT id,receipt_no AS no,paid_at AS date,amount,method,note FROM payments WHERE booking_id=? ORDER BY id').all(b.id),
  };
}
const getBooking = (id) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!b) throw new HttpError(404, 'الحجز غير موجود');
  return b;
};
const dueOf = (id) => db.prepare(`SELECT
  (SELECT amount FROM bookings WHERE id=@id) + COALESCE((SELECT SUM(price) FROM booking_services WHERE booking_id=@id),0)
  - COALESCE((SELECT SUM(amount) FROM payments WHERE booking_id=@id),0) AS due`).get({ id }).due;

function state() {
  return {
    bookings: db.prepare("SELECT * FROM bookings WHERE status='active' ORDER BY id DESC").all().map(bookingRow),
    inventory: db.prepare('SELECT id,name,unit,qty,min_qty AS min FROM inventory_items ORDER BY id').all(),
    requests: db.prepare('SELECT id,code,item_id AS itemId,qty,note,status,created_at AS date FROM purchase_requests ORDER BY id').all(),
    orders: db.prepare('SELECT id,code,request_id AS requestId,supplier,cost,status FROM purchase_orders ORDER BY id').all(),
  };
}

/* منع الحجز المزدوج: نفس اليوم مع تداخل الأقسام (القسمين يتعارض مع أي قسم) */
function assertNoConflict(date, section, excludeId) {
  const c = db.prepare(`SELECT code, section, client FROM bookings
    WHERE status='active' AND event_date=? AND id<>? AND (section='both' OR ?='both' OR section=?) LIMIT 1`)
    .get(date, excludeId || 0, section, section);
  if (c) throw new HttpError(409, `لا يمكن الحجز: يوجد حجز ${c.code} (${c.client}) في نفس اليوم ويتعارض مع هذا القسم.`);
}

function addPayment(bookingId, userId, body, defaultNote = '') {
  const b = getBooking(bookingId);
  if (b.status !== 'active') throw bad('الحجز ملغى');
  const amount = num(body.amount, 'المبلغ', { gt: true });
  if (amount > round2(dueOf(bookingId))) throw bad('المبلغ أكبر من المتبقي');
  const method = oneOf(body.method || 'cash', METHODS, 'طريقة الدفع');
  const no = 'R-' + nextCounter('receipt', 1);
  db.prepare('INSERT INTO payments(receipt_no,booking_id,amount,method,note,paid_at,created_by) VALUES(?,?,?,?,?,?,?)')
    .run(no, bookingId, amount, method, optStr(body.note) || defaultNote, todayStr(), userId);
  return no;
}

/* ---------- routes ---------- */
const routes = [];
const route = (method, pattern, perm, handler) => {
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), perm, handler });
};
const pid = (p) => { const n = Number(p); if (!Number.isInteger(n) || n < 1) throw bad('معرّف غير صالح'); return n; };

route('GET', '/api/me', null, ({ user }) => ({ user: publicUser(user) }));
route('GET', '/api/state', null, () => state());

/* الحجوزات */
route('POST', '/api/bookings', 'booking.write', ({ body, user }) => tx(() => {
  const date = dateStr(body.date, 'التاريخ');
  if (date < todayStr()) throw bad('لا يمكن الحجز في تاريخ سابق');
  const section = oneOf(body.section, SECTIONS, 'القسم');
  const amount = num(body.amount, 'قيمة العقد');
  const deposit = num(body.deposit ?? 0, 'العربون');
  if (deposit > amount) throw bad('العربون أكبر من قيمة العقد');
  assertNoConflict(date, section);
  const code = 'B-' + nextCounter('booking', 1001);
  const id = Number(db.prepare('INSERT INTO bookings(code,event_date,section,client,phone,amount,created_by) VALUES(?,?,?,?,?,?,?)')
    .run(code, date, section, str(body.client, 'اسم العميل'), str(body.phone, 'الجوال', 30), amount, user.id).lastInsertRowid);
  if (deposit > 0) addPayment(id, user.id, { amount: deposit, method: body.method }, 'عربون');
  return { booking: bookingRow(getBooking(id)) };
}));

route('PUT', '/api/bookings/:id', 'booking.write', ({ params, body }) => tx(() => {
  const id = pid(params.id); const b = getBooking(id);
  if (b.status !== 'active') throw bad('الحجز ملغى');
  const date = dateStr(body.date, 'التاريخ'); const section = oneOf(body.section, SECTIONS, 'القسم');
  const amount = num(body.amount, 'قيمة العقد');
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id=?').get(id).s;
  const svc = db.prepare('SELECT COALESCE(SUM(price),0) s FROM booking_services WHERE booking_id=?').get(id).s;
  if (amount + svc < paid) throw bad('قيمة العقد أقل من المبالغ المستلمة');
  assertNoConflict(date, section, id);
  db.prepare('UPDATE bookings SET event_date=?,section=?,client=?,phone=?,amount=? WHERE id=?')
    .run(date, section, str(body.client, 'اسم العميل'), str(body.phone, 'الجوال', 30), amount, id);
  return { booking: bookingRow(getBooking(id)) };
}));

route('POST', '/api/bookings/:id/cancel', 'booking.write', ({ params }) => tx(() => {
  const id = pid(params.id); getBooking(id);
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(id);
  return { ok: true };
}));

route('POST', '/api/bookings/:id/payments', 'payment.write', ({ params, body, user }) => tx(() => {
  const no = addPayment(pid(params.id), user.id, body);
  return { receipt: no, booking: bookingRow(getBooking(pid(params.id))) };
}));

route('POST', '/api/bookings/:id/services', 'booking.write', ({ params, body }) => tx(() => {
  const id = pid(params.id); const b = getBooking(id);
  if (b.status !== 'active') throw bad('الحجز ملغى');
  db.prepare('INSERT INTO booking_services(booking_id,name,price) VALUES(?,?,?)').run(id, str(body.name, 'الخدمة'), num(body.price, 'السعر'));
  return { booking: bookingRow(getBooking(id)) };
}));

route('DELETE', '/api/bookings/:id/services/:sid', 'booking.write', ({ params }) => tx(() => {
  const id = pid(params.id); const sid = pid(params.sid);
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id=?').get(id).s;
  const s = db.prepare('SELECT price FROM booking_services WHERE id=? AND booking_id=?').get(sid, id);
  if (!s) throw new HttpError(404, 'الخدمة غير موجودة');
  if (round2(dueOf(id) - s.price) < 0 && paid > 0) throw bad('لا يمكن الحذف: المبالغ المستلمة تتجاوز قيمة العقد بعد الحذف');
  db.prepare('DELETE FROM booking_services WHERE id=?').run(sid);
  return { booking: bookingRow(getBooking(id)) };
}));

/* المخزون */
route('POST', '/api/inventory', 'inventory.write', ({ body }) => {
  db.prepare('INSERT INTO inventory_items(name,unit,qty,min_qty) VALUES(?,?,?,?)')
    .run(str(body.name, 'الصنف'), str(body.unit, 'الوحدة', 30), num(body.qty, 'الكمية', { int: true }), num(body.min, 'الحد الأدنى', { int: true }));
  return { ok: true };
});
route('POST', '/api/inventory/:id/adjust', 'inventory.write', ({ params, body }) => tx(() => {
  const id = pid(params.id);
  const it = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(id);
  if (!it) throw new HttpError(404, 'الصنف غير موجود');
  const delta = num(body.delta, 'التغيير', { min: -1e9, int: true });
  if (it.qty + delta < 0) throw bad('الكمية لا يمكن أن تكون سالبة');
  db.prepare('UPDATE inventory_items SET qty=?, min_qty=? WHERE id=?').run(it.qty + delta, num(body.min ?? it.min_qty, 'الحد الأدنى', { int: true }), id);
  return { ok: true };
}));

/* طلبات الشراء */
route('POST', '/api/requests', 'request.create', ({ body, user }) => tx(() => {
  const itemId = pid(body.itemId);
  if (!db.prepare('SELECT 1 FROM inventory_items WHERE id=?').get(itemId)) throw bad('الصنف غير موجود');
  db.prepare('INSERT INTO purchase_requests(code,item_id,qty,note,created_at,created_by) VALUES(?,?,?,?,?,?)')
    .run('PR-' + nextCounter('pr', 1), itemId, num(body.qty, 'الكمية', { min: 1, int: true }), optStr(body.note), todayStr(), user.id);
  return { ok: true };
}));
const decide = (status) => ({ params }) => tx(() => {
  const r = db.prepare('SELECT status FROM purchase_requests WHERE id=?').get(pid(params.id));
  if (!r) throw new HttpError(404, 'الطلب غير موجود');
  if (r.status !== 'pending') throw new HttpError(409, 'تمت معالجة هذا الطلب مسبقًا');
  db.prepare('UPDATE purchase_requests SET status=? WHERE id=?').run(status, pid(params.id));
  return { ok: true };
});
route('POST', '/api/requests/:id/approve', 'request.approve', decide('approved'));
route('POST', '/api/requests/:id/reject', 'request.approve', decide('rejected'));

/* أوامر الشراء */
route('POST', '/api/orders', 'order.write', ({ body }) => tx(() => {
  const rid = pid(body.requestId);
  const r = db.prepare('SELECT status FROM purchase_requests WHERE id=?').get(rid);
  if (!r) throw new HttpError(404, 'الطلب غير موجود');
  if (r.status !== 'approved') throw new HttpError(409, 'الطلب غير معتمد أو صدر له أمر شراء');
  db.prepare('INSERT INTO purchase_orders(code,request_id,supplier,cost) VALUES(?,?,?,?)')
    .run('PO-' + nextCounter('po', 1), rid, str(body.supplier, 'المورد'), num(body.cost, 'التكلفة'));
  db.prepare("UPDATE purchase_requests SET status='ordered' WHERE id=?").run(rid);
  return { ok: true };
}));
route('POST', '/api/orders/:id/receive', 'order.write', ({ params }) => tx(() => {
  const o = db.prepare(`SELECT o.status, r.qty, r.item_id FROM purchase_orders o JOIN purchase_requests r ON r.id=o.request_id WHERE o.id=?`).get(pid(params.id));
  if (!o) throw new HttpError(404, 'الأمر غير موجود');
  if (o.status !== 'ordered') throw new HttpError(409, 'تم استلام هذا الأمر مسبقًا');
  db.prepare('UPDATE inventory_items SET qty = qty + ? WHERE id=?').run(o.qty, o.item_id);
  db.prepare("UPDATE purchase_orders SET status='received' WHERE id=?").run(pid(params.id));
  return { ok: true };
}));

/* ---------- auth ---------- */
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.full_name, role: u.role, branch: u.branch, perms: permsOf(u.role) });
const failures = new Map(); // ip|user -> {n, until}
function checkThrottle(key) {
  const f = failures.get(key);
  if (f && f.n >= 5 && Date.now() < f.until) throw new HttpError(429, 'محاولات كثيرة، حاول بعد 10 دقائق');
}
function noteFailure(key) {
  const f = failures.get(key);
  failures.set(key, { n: (f && Date.now() < f.until ? f.n : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
}
function login(body, ip) {
  const username = optStr(body.username, 60); const password = typeof body.password === 'string' ? body.password : '';
  const key = ip + '|' + username.toLowerCase();
  checkThrottle(key);
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // نفّذ الاشتقاق دائمًا لتقليل الفرق الزمني بين مستخدم موجود وغير موجود
  const probe = u || { salt: '00', password_hash: '00'.repeat(64) };
  const ok = verifyPassword(password, probe.salt, probe.password_hash) && u;
  if (!ok) { noteFailure(key); throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة'); }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, u.id, Math.floor(Date.now() / 1000) + SESSION_TTL);
  return { token, user: publicUser(u) };
}
function authenticate(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`)
    .get(m[1], Math.floor(Date.now() / 1000)) || null;
}

/* ---------- http plumbing ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
const sendJSON = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'الطلب كبير جدًا')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!size) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); } catch { reject(bad('JSON غير صالح')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !/^application\/json/.test(req.headers['content-type'] || '') && Number(req.headers['content-length'] || 0) > 0) {
    throw new HttpError(415, 'نوع المحتوى يجب أن يكون JSON');
  }
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
  if (req.method === 'POST' && pathname === '/api/login') return sendJSON(res, 200, login(body, req.socket.remoteAddress || ''));
  const user = authenticate(req);
  if (!user) throw new HttpError(401, 'يلزم تسجيل الدخول');
  if (req.method === 'POST' && pathname === '/api/logout') {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.headers.authorization.slice(7));
    return sendJSON(res, 200, { ok: true });
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname); if (!m) continue;
    if (r.perm && !PERMS[r.perm].includes(user.role)) throw new HttpError(403, 'ليست لديك صلاحية لهذا الإجراء');
    return sendJSON(res, 200, r.handler({ params: m.groups || {}, body, user }));
  }
  throw new HttpError(404, 'غير موجود');
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method Not Allowed');
  let rel; try { rel = decodeURIComponent(pathname); } catch { throw bad('مسار غير صالح'); }
  const file = path.resolve(STATIC_DIR, '.' + (rel === '/' ? '/index.html' : rel));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + path.sep)) throw new HttpError(404, 'غير موجود');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, req.method === 'HEAD' ? '' : data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    try {
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else serveStatic(req, res, pathname);
    } catch (e) {
      if (!(e instanceof HttpError)) { console.error(e); e = new HttpError(500, 'خطأ داخلي في الخادم'); }
      if (!res.headersSent) sendJSON(res, e.status, { error: e.message });
    }
  });
}

/* تنظيف الجلسات المنتهية */
function purgeSessions() { db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000)); }

if (require.main === module) {
  const pw = seedIfEmpty();
  purgeSessions(); setInterval(purgeSessions, 3600_000).unref();
  createServer().listen(PORT, HOST, () => {
    console.log(`الخادم يعمل على http://${HOST}:${PORT}`);
    if (pw) {
      console.log('تم إنشاء المستخدمين: admin, sales, accountant, store');
      console.log(`كلمة المرور الأولية (تظهر مرة واحدة): ${pw}`);
    }
  });
}
module.exports = { createServer, seedIfEmpty };
