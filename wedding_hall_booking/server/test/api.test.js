'use strict';
process.env.DB_PATH = ':memory:';
process.env.SEED_PASSWORD = 'test-pass-123';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, seedIfEmpty } = require('../server');

let base; let server;
const tokens = {};
test.before(async () => {
  seedIfEmpty();
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['admin', 'sales', 'accountant', 'store']) {
    const r = await call('POST', '/api/login', { username: u, password: 'test-pass-123' });
    tokens[u] = r.body.token;
  }
});
test.after(() => server.close());

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const future = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

test('authentication is required and bad passwords are rejected', async () => {
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/api/state', null, 'bogus')).status, 401);
});

test('double booking is rejected, overlapping sections conflict', async () => {
  const day = future(40);
  const mk = (section) => call('POST', '/api/bookings', { client: 'عميل', phone: '050', date: day, section, amount: 1000 }, tokens.sales);
  assert.equal((await mk('women')).status, 200);
  assert.equal((await mk('women')).status, 409);
  assert.equal((await mk('both')).status, 409);
  assert.equal((await mk('men')).status, 200);
  assert.equal((await mk('men')).status, 409);
});

test('past dates and invalid input are rejected', async () => {
  const b = (o) => call('POST', '/api/bookings', { client: 'x', phone: '1', date: future(50), section: 'men', amount: 10, ...o }, tokens.sales);
  assert.equal((await b({ date: future(-1) })).status, 400);
  assert.equal((await b({ section: 'kids' })).status, 400);
  assert.equal((await b({ amount: -5 })).status, 400);
  assert.equal((await b({ amount: 'abc' })).status, 400);
  assert.equal((await b({ deposit: 99999 })).status, 400);
});

test('payments cannot exceed balance; roles are enforced', async () => {
  const r = await call('POST', '/api/bookings', { client: 'p', phone: '1', date: future(60), section: 'both', amount: 1000, deposit: 200 }, tokens.sales);
  const id = r.body.booking.id;
  assert.equal(r.body.booking.payments.length, 1);
  assert.equal((await call('POST', `/api/bookings/${id}/payments`, { amount: 900 }, tokens.accountant)).status, 400);
  const ok = await call('POST', `/api/bookings/${id}/payments`, { amount: 800, method: 'card' }, tokens.accountant);
  assert.equal(ok.status, 200);
  assert.equal((await call('POST', `/api/bookings/${id}/payments`, { amount: 1 }, tokens.accountant)).status, 400);
  assert.equal((await call('POST', `/api/bookings/${id}/services`, { name: 'كوشة', price: 10 }, tokens.accountant)).status, 403);
  assert.equal((await call('POST', `/api/bookings/${id}/payments`, { amount: 1 }, tokens.store)).status, 403);
});

test('cancelled booking frees the slot', async () => {
  const day = future(70);
  const a = await call('POST', '/api/bookings', { client: 'c', phone: '1', date: day, section: 'both', amount: 5 }, tokens.sales);
  assert.equal((await call('POST', `/api/bookings/${a.body.booking.id}/cancel`, null, tokens.sales)).status, 200);
  assert.equal((await call('POST', '/api/bookings', { client: 'd', phone: '1', date: day, section: 'both', amount: 5 }, tokens.sales)).status, 200);
});

test('purchasing flow: request → approve → order → receive updates stock', async () => {
  const st = await call('GET', '/api/state', null, tokens.admin);
  const item = st.body.inventory[0];
  const rq = await call('POST', '/api/requests', { itemId: item.id, qty: 25 }, tokens.store);
  assert.equal(rq.status, 200);
  const reqId = (await call('GET', '/api/state', null, tokens.admin)).body.requests.at(-1).id;
  assert.equal((await call('POST', `/api/requests/${reqId}/approve`, null, tokens.store)).status, 403);
  assert.equal((await call('POST', '/api/orders', { requestId: reqId, supplier: 's', cost: 1 }, tokens.store)).status, 409);
  assert.equal((await call('POST', `/api/requests/${reqId}/approve`, null, tokens.admin)).status, 200);
  assert.equal((await call('POST', `/api/requests/${reqId}/approve`, null, tokens.admin)).status, 409);
  assert.equal((await call('POST', '/api/orders', { requestId: reqId, supplier: 'مورد', cost: 500 }, tokens.store)).status, 200);
  assert.equal((await call('POST', '/api/orders', { requestId: reqId, supplier: 'مورد', cost: 500 }, tokens.store)).status, 409);
  const orderId = (await call('GET', '/api/state', null, tokens.admin)).body.orders.at(-1).id;
  assert.equal((await call('POST', `/api/orders/${orderId}/receive`, null, tokens.store)).status, 200);
  assert.equal((await call('POST', `/api/orders/${orderId}/receive`, null, tokens.store)).status, 409);
  const after = (await call('GET', '/api/state', null, tokens.admin)).body.inventory.find((i) => i.id === item.id);
  assert.equal(after.qty, item.qty + 25);
});

test('inventory cannot go negative', async () => {
  const item = (await call('GET', '/api/state', null, tokens.admin)).body.inventory[0];
  assert.equal((await call('POST', `/api/inventory/${item.id}/adjust`, { delta: -1e6 }, tokens.store)).status, 400);
});

test('static files are served and path traversal is blocked', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  const trav = await fetch(base + '/..%2fserver%2fdb.js');
  assert.equal(trav.status, 404);
  const trav2 = await fetch(base + '/%2e%2e/server/db.js');
  assert.equal(trav2.status, 404);
});
