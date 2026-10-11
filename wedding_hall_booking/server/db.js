'use strict';
/* قاعدة البيانات: SQLite عبر الوحدة المدمجة node:sqlite (Node 22.5+) بدون اعتماديات خارجية. */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'qasr.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','sales','accountant','storekeeper')),
  branch        TEXT NOT NULL DEFAULT 'الفرع الرئيسي',
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  event_date TEXT NOT NULL,
  section    TEXT NOT NULL CHECK (section IN ('women','men','both')),
  client     TEXT NOT NULL,
  phone      TEXT NOT NULL,
  amount     REAL NOT NULL CHECK (amount >= 0),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(event_date, status);
CREATE TABLE IF NOT EXISTS booking_services (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  price      REAL NOT NULL CHECK (price >= 0)
);
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount     REAL NOT NULL CHECK (amount > 0),
  method     TEXT NOT NULL CHECK (method IN ('cash','card','transfer')),
  note       TEXT NOT NULL DEFAULT '',
  paid_at    TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  unit    TEXT NOT NULL,
  qty     INTEGER NOT NULL CHECK (qty >= 0),
  min_qty INTEGER NOT NULL DEFAULT 0 CHECK (min_qty >= 0)
);
CREATE TABLE IF NOT EXISTS purchase_requests (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  item_id    INTEGER NOT NULL REFERENCES inventory_items(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','ordered')),
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  request_id INTEGER NOT NULL UNIQUE REFERENCES purchase_requests(id),
  supplier   TEXT NOT NULL,
  cost       REAL NOT NULL CHECK (cost >= 0),
  status     TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','received'))
);
`);

/* ---------- helpers ---------- */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function nextCounter(name, start) {
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
  const v = row ? row.value + 1 : start;
  db.prepare('INSERT INTO counters(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, v);
  return v;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, salt, hash) {
  const a = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- first-run seed ---------- */
function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return null;
  const password = process.env.SEED_PASSWORD || crypto.randomBytes(6).toString('base64url');
  const users = [
    ['admin', 'المدير العام', 'admin'],
    ['sales', 'موظف المبيعات', 'sales'],
    ['accountant', 'المحاسب', 'accountant'],
    ['store', 'أمين المخزن', 'storekeeper'],
  ];
  const ins = db.prepare('INSERT INTO users(username,full_name,role,password_hash,salt) VALUES(?,?,?,?,?)');
  for (const [u, n, r] of users) { const { hash, salt } = hashPassword(password); ins.run(u, n, r, hash, salt); }

  if (process.env.SEED_DEMO !== '0') {
    const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
    const addBooking = (date, section, client, phone, amount, services, payments) => {
      const id = Number(db.prepare('INSERT INTO bookings(code,event_date,section,client,phone,amount) VALUES(?,?,?,?,?,?)')
        .run('B-' + nextCounter('booking', 1001), date, section, client, phone, amount).lastInsertRowid);
      for (const [n, p] of services) db.prepare('INSERT INTO booking_services(booking_id,name,price) VALUES(?,?,?)').run(id, n, p);
      for (const [amt, method, note, paid] of payments) {
        db.prepare('INSERT INTO payments(receipt_no,booking_id,amount,method,note,paid_at) VALUES(?,?,?,?,?,?)')
          .run('R-' + nextCounter('receipt', 1), id, amt, method, note, paid);
      }
    };
    addBooking(d(3), 'women', 'عائلة السالم', '0501112233', 18000, [['كوشة', 2500]], [[6000, 'cash', 'عربون', d(-20)]]);
    addBooking(d(3), 'men', 'عائلة السالم', '0501112233', 12000, [], [[12000, 'transfer', '', d(-20)]]);
    addBooking(d(10), 'both', 'شركة النور', '0555556677', 35000, [['تنسيق ورد', 3000]], [[10000, 'card', 'عربون', d(-5)]]);
    const item = db.prepare('INSERT INTO inventory_items(name,unit,qty,min_qty) VALUES(?,?,?,?)');
    item.run('كراسي', 'قطعة', 600, 400); item.run('مفارش طاولات', 'قطعة', 45, 60);
    item.run('مياه شرب', 'كرتون', 120, 80); item.run('ورد صناعي', 'حزمة', 30, 20);
    const pr = db.prepare('INSERT INTO purchase_requests(code,item_id,qty,note,status,created_at) VALUES(?,?,?,?,?,?)');
    pr.run('PR-' + nextCounter('pr', 1), 2, 40, 'نقص مفارش', 'pending', d(-1));
    pr.run('PR-' + nextCounter('pr', 1), 3, 50, '', 'approved', d(-2));
  }
  return password;
}

module.exports = { db, tx, nextCounter, hashPassword, verifyPassword, seedIfEmpty };
