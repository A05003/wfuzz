'use strict';
process.env.NOTIFY_DRIVER = 'memory';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.SEED_PASSWORD = 'Passw0rd-test';
process.env.SEED_OWNER_EMAIL = 'owner@venue.test';
process.env.SEED_OWNER_PHONE = '+966 50 111 2233';
process.env.SEED_MANAGER_EMAIL = 'manager@venue.test';
process.env.VENUE_NAME_EN = 'Test Palace';
process.env.VENUE_NAME_AR = 'قصر الاختبار';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../kernel/db');
const { seed } = require('../seed');
const { createServer } = require('../app');
const { outbox } = require('../modules/rbac/notify');
const jwt = require('../modules/rbac/jwt');
const { computeSplit } = require('../modules/settlement/profit');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PW = 'Passw0rd-test';
let base, server, ids = {};
const jars = {};   // actor -> cookie
async function call(method, url, body, who, extraHeaders = {}) {
  const res = await fetch(base + url, {
    method, redirect: 'manual',
    headers: { 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who && jars[who] ? { Cookie: jars[who] } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})), set: res.headers.getSetCookie?.() || [] };
}
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
async function login(who, username = who, password = PW, branch) {
  const r = await call('POST', '/api/auth/login', { username, password, ...(branch !== undefined ? { branch } : {}) });
  if (r.status === 200) jars[who] = r.set[0].split(';')[0];
  return r;
}

test.before(async () => {
  await db.open({ url: '', dataDir: ':memory:' });
  await seed({ demo: true });
  server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
  for (const [who, name] of [['owner', 'owner'], ['manager', 'manager'], ['north', 'manager.north'], ['sup', 'supervisor']]) assert.equal((await login(who, name)).status, 200, name);
  const b = await db.system('SELECT id, code FROM branches'); ids.main = b.find((x) => x.code === 'MAIN').id; ids.north = b.find((x) => x.code === 'NORTH').id;
  const h = await db.system('SELECT id, branch_id FROM halls ORDER BY id'); ids.grand = h[0].id; ids.small = h[1].id; ids.northHall = h[2].id;
});
test.after(async () => { server.close(); await db.close(); });

/* ------------------------------------------------------------------ authentication ------------------------------------------------------------------ */
test('login page data is public; everything else needs a session', async () => {
  const v = await call('GET', '/api/public/venue');
  assert.equal(v.body.venue.name_en, 'Test Palace'); assert.equal(JSON.stringify(v.body).includes('phone'), false);
  const br = (await call('GET', '/api/public/branches')).body.branches; assert.equal(br.length, 2); assert.deepEqual(Object.keys(br[0]).sort(), ['id', 'name_ar', 'name_en']);
  for (const url of ['/api/dashboard', '/api/audit', '/api/security/overview', '/api/field/today']) assert.equal((await call('GET', url)).status, 401, url);
});

test('JWT: HttpOnly + SameSite=Strict cookie, claims bound to role and branch, tampering rejected', async () => {
  const mgr = await call('POST', '/api/auth/login', { username: 'Manager', password: PW });        // username is case-insensitive
  assert.match(mgr.set[0], /HttpOnly/); assert.match(mgr.set[0], /SameSite=Strict/);
  const token = decodeURIComponent(mgr.set[0].split(';')[0].split('=')[1]);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(claims.role, 'manager'); assert.equal(claims.branch_id, ids.main); assert.equal(claims.sub, String(mgr.body.user.id)); assert.ok(claims.sid && claims.exp > claims.iat);
  const own = await call('POST', '/api/auth/login', { username: 'owner', password: PW });
  assert.equal(JSON.parse(Buffer.from(decodeURIComponent(own.set[0].split(';')[0].split('=')[1]).split('.')[1], 'base64url')).branch_id, 'ALL', 'owner token carries the global scope');
  assert.equal(JSON.stringify(mgr.body).includes('password'), false);
  // forge: promote the claims to owner / ALL while keeping the old signature, or use alg "none"
  const [h, , sig] = token.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, role: 'owner', branch_id: 'ALL' })).toString('base64url')}.${sig}`;
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, role: 'owner' })).toString('base64url')}.`;
  for (const t of [forged, none, 'garbage', token.slice(0, -2) + 'xx']) {
    const r = await fetch(base + '/api/dashboard', { headers: { Cookie: `qasr_sid=${encodeURIComponent(t)}` } });
    assert.equal(r.status, 401, 'tampered token must be rejected');
  }
  // the same claims signed with the wrong key
  const wrongKey = `${h}.${token.split('.')[1]}.${crypto.createHmac('sha256', 'other').update(`${h}.${token.split('.')[1]}`).digest('base64url')}`;
  assert.equal((await fetch(base + '/api/dashboard', { headers: { Cookie: `qasr_sid=${wrongKey}` } })).status, 401);
  assert.ok(jwt.verify(token));
});

test('login journal: every attempt records user, time, IP, device and assigned branch', async () => {
  await call('POST', '/api/auth/login', { username: 'manager', password: 'wrong-password' });
  await call('POST', '/api/auth/login', { username: 'nobody.here', password: 'x' });
  const log = (await call('GET', '/api/security/logins?limit=50', null, 'owner')).body.logins;
  const ok = log.find((l) => l.username === 'manager' && l.success), bad = log.find((l) => l.username === 'manager' && !l.success && l.failure_reason === 'bad_credentials');
  assert.ok(ok && bad);
  assert.equal(ok.assigned_branch_id, ids.main); assert.match(ok.device_info, /Chrome 120 · Windows · Desktop/); assert.ok(ok.ip_address && ok.timestamp && ok.user_id);
  const ghost = log.find((l) => l.username === 'nobody.here'); assert.ok(ghost && ghost.user_id === null && ghost.success === false);
  assert.ok(log.find((l) => l.username === 'owner' && l.success && l.assigned_branch_id === null), 'the owner is global (no branch)');
  assert.equal((await call('GET', '/api/security/logins', null, 'manager')).status, 403);
  assert.equal((await call('GET', '/api/security/logins?failed=1', null, 'owner')).body.logins.every((l) => !l.success), true);
  await assert.rejects(db.system('DELETE FROM login_logs'), /append-only/);
  await assert.rejects(db.system("UPDATE login_logs SET success = true"), /append-only/);
});

test('branch-bound login: a manager can only enter their own branch; the owner may pick any branch or ALL', async () => {
  const bad = await call('POST', '/api/auth/login', { username: 'manager', password: PW, branch: ids.north });
  assert.equal(bad.status, 403); assert.equal(bad.body.error, 'BRANCH_MISMATCH'); assert.equal(bad.set.length, 0, 'no session is issued');
  assert.equal((await call('POST', '/api/auth/login', { username: 'manager', password: PW, branch: ids.main })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { username: 'manager', password: PW, branch: 'ALL' })).status, 200, "the form's default is not a violation");
  const o = await call('POST', '/api/auth/login', { username: 'owner', password: PW, branch: ids.north });
  assert.equal(o.body.user.scopeBranch, ids.north); assert.equal(o.body.user.branchId, null);
  assert.equal((await call('POST', '/api/auth/login', { username: 'owner', password: PW, branch: 99999 })).status, 400);
  const log = (await call('GET', '/api/security/logins?failed=1', null, 'owner')).body.logins;
  assert.ok(log.find((l) => l.failure_reason === 'branch_mismatch' && l.requested_branch === String(ids.north)));
  const ev = (await call('GET', '/api/security/events', null, 'owner')).body.events;
  assert.ok(ev.find((e) => e.event_type === 'BRANCH_VIOLATION' && e.path === '/api/auth/login'));
});

/* ------------------------------------------------------------------ branch isolation ------------------------------------------------------------------ */
test('data isolation: branch users only ever see their own branch', async () => {
  const m = (await call('GET', '/api/dashboard', null, 'manager')).body, n = (await call('GET', '/api/dashboard', null, 'north')).body;
  assert.ok(m.contracts.length >= 5 && m.contracts.every((c) => c.branch_id === ids.main));
  assert.ok(n.contracts.length >= 2 && n.contracts.every((c) => c.branch_id === ids.north));
  assert.equal(m.todays.length, 2, 'a manager sees both of today\'s events (one already closed)'); assert.equal(n.todays.length, 1);
  assert.deepEqual((await call('GET', '/api/halls', null, 'north')).body.halls.map((h) => h.id), [ids.northHall]);
  assert.deepEqual((await call('GET', '/api/branches', null, 'manager')).body.branches.map((b) => b.id), [ids.main], 'a manager only sees their own branch');
  const northContract = n.contracts[0];
  // direct object reference to another branch's contract: invisible (404), and every write path is refused
  assert.equal((await call('GET', `/api/contracts/${northContract.id}`, null, 'manager')).status, 404);
  assert.equal((await call('POST', `/api/contracts/${northContract.id}/payments`, { amount: 1, method: 'cash' }, 'manager')).status, 404);
  assert.equal((await call('POST', `/api/contracts/${northContract.id}/services`, { name: 'x', unitPrice: 1 }, 'manager')).status, 404);
  assert.equal((await call('POST', `/api/contracts/${northContract.id}/settlement`, null, 'manager')).status, 404);
  assert.equal((await call('POST', `/api/contracts/${northContract.id}/cancel`, null, 'manager')).status === 200, false);
  assert.equal((await call('GET', '/api/contracts/search?q=' + encodeURIComponent('الشمري'), null, 'manager')).body.results.length, 0);
  const cal = (await call('GET', `/api/calendar?month=${ymd(0).slice(0, 7)}`, null, 'manager')).body.events; assert.ok(cal.every((e) => e.hall_id !== ids.northHall));
  // creating a contract in another branch's hall
  const x = await call('POST', '/api/contracts', { hallId: ids.northHall, eventDate: ymd(90), section: 'men', clientName: 'x', clientPhone: '1', baseAmount: 100 }, 'manager');
  assert.equal(x.status, 403); assert.equal(x.body.error, 'BRANCH_VIOLATION');
  // the audit trail of a branch's contract is not reachable by the other branch's manager
  assert.equal((await call('GET', '/api/audit', null, 'manager')).status, 403);
});

test('inspection middleware: an explicit foreign branch in the query or body is refused before any SQL and journalled', async () => {
  assert.equal((await call('GET', `/api/dashboard?branch=${ids.north}`, null, 'manager')).body.error, 'BRANCH_VIOLATION');
  assert.equal((await call('POST', '/api/contracts', { branchId: ids.north, hallId: ids.grand, eventDate: ymd(91), section: 'men', clientName: 'x', clientPhone: '1', baseAmount: 1 }, 'manager')).body.error, 'BRANCH_VIOLATION');
  assert.equal((await call('PUT', '/api/auth/scope', { branch: ids.north }, 'manager')).status, 403, 'only the owner can switch scope');
  assert.equal((await call('GET', `/api/dashboard?branch=${ids.main}`, null, 'manager')).status, 200, 'naming your own branch is fine');
  const ev = (await call('GET', '/api/security/events', null, 'owner')).body.events;
  const viol = ev.filter((e) => e.event_type === 'BRANCH_VIOLATION' && e.full_name === 'مدير الفرع الرئيسي');
  assert.ok(viol.length >= 3 && viol[0].ip_address && viol[0].path);
  await call('GET', '/api/security/overview', null, 'manager');
  assert.ok((await call('GET', '/api/security/events', null, 'owner')).body.events.find((e) => e.event_type === 'PERMISSION_DENIED' && e.path === '/api/security/overview'));
});

test('owner: consolidated view across branches, branch switcher, cross-branch financial inspection', async () => {
  const all = (await call('GET', '/api/dashboard', null, 'owner')).body;
  assert.deepEqual([...new Set(all.contracts.map((c) => c.branch_id))].sort(), [ids.main, ids.north].sort());
  assert.equal(all.todays.length, 3);
  assert.equal((await call('PUT', '/api/auth/scope', { branch: ids.north }, 'owner')).body.scopeBranch, ids.north);
  const one = (await call('GET', '/api/dashboard', null, 'owner')).body;
  assert.ok(one.contracts.every((c) => c.branch_id === ids.north)); assert.equal(one.todays.length, 1);
  assert.equal((await call('GET', '/api/auth/me', null, 'owner')).body.user.scopeBranch, ids.north);
  // the inspection page ignores the switcher: it always shows every branch
  const fin = (await call('GET', '/api/security/branches', null, 'owner')).body.branches;
  assert.equal(fin.length, 2);
  const mainFin = fin.find((b) => Number(b.branch_id) === ids.main), northFin = fin.find((b) => Number(b.branch_id) === ids.north);
  assert.ok(mainFin.contracts >= 5 && northFin.contracts >= 2 && mainFin.net_profit === 8900 && mainFin.deleted_items >= 1 && mainFin.flagged_events >= 1 && mainFin.late_settlements >= 1);
  assert.equal((await call('PUT', '/api/auth/scope', { branch: 'ALL' }, 'owner')).body.scopeBranch, null);
  assert.equal((await call('PUT', '/api/auth/scope', { branch: 424242 }, 'owner')).status, 400);
});

/* ------------------------------------------------------------------ field supervisor ------------------------------------------------------------------ */
test('field supervisor: restricted to today\'s active events, checklist and direct expenses — no contract money', async () => {
  for (const [m, u] of [['GET', '/api/dashboard'], ['GET', '/api/calendar?month=' + ymd(0).slice(0, 7)], ['GET', '/api/contracts/search?q=a'], ['GET', '/api/security/overview'], ['GET', '/api/users'], ['GET', '/api/settings/split']]) {
    assert.equal((await call(m, u, null, 'sup')).status, 403, `${m} ${u}`);
  }
  assert.equal((await call('POST', '/api/contracts', { hallId: ids.grand, eventDate: ymd(95), section: 'men', clientName: 'x', clientPhone: '1', baseAmount: 1 }, 'sup')).status, 403);
  const t = await call('GET', '/api/field/today', null, 'sup');
  assert.equal(t.status, 200); assert.equal(t.body.events.length, 1, 'only MAIN\'s ACTIVE event today (the men\'s event is already settled and closed)');
  const flat = JSON.stringify(t.body);
  for (const secret of ['base_amount', 'total_amount', 'paid_total', 'balance_due', 'client_phone', 'discount', 'receipt']) assert.equal(flat.includes(secret), false, `supervisor must not receive ${secret}`);
  const ev = t.body.events[0];
  assert.deepEqual((await call('POST', `/api/field/events/${ev.id}/checklist/init`, null, 'sup')).body, { created: 5 });
  assert.deepEqual((await call('POST', `/api/field/events/${ev.id}/checklist/init`, null, 'sup')).body, { created: 0 }, 'idempotent');
  const items = (await call('GET', '/api/field/today', null, 'sup')).body.events.find((e) => e.id === ev.id).checklist;
  assert.equal(items.length, 5); assert.ok(items.every((i) => i.title.startsWith('chk.')));
  assert.equal((await call('PATCH', `/api/checklist/${items[0].id}`, { isDone: true, note: 'جاهز' }, 'sup')).status, 200);
  const [row] = await db.system('SELECT is_done, done_by FROM event_checklist_items WHERE id = $1', [items[0].id]); assert.equal(row.is_done, true); assert.equal(row.done_by, (await call('GET', '/api/auth/me', null, 'sup')).body.user.id);
  // direct expense input: opens the draft settlement automatically
  const exp = await call('POST', `/api/field/events/${ev.id}/expenses`, { category: 'labor', description: 'أجور عمال اليوم', amount: 450 }, 'sup');
  assert.equal(exp.status, 200); assert.ok(exp.body.settlementId);
  const after = (await call('GET', '/api/field/today', null, 'sup')).body.events.find((e) => e.id === ev.id);
  assert.equal(after.expenses.length, 1); assert.equal(after.settlement.status, 'draft');
  // a supervisor cannot finalize, change a settlement, or touch money
  assert.equal((await call('POST', `/api/settlements/${exp.body.settlementId}/finalize`, null, 'sup')).body.error, 'FORBIDDEN');
  assert.equal((await call('DELETE', `/api/expenses/${after.expenses[0].id}`, null, 'manager')).status, 200, 'the manager can void it');
  assert.equal((await call('POST', `/api/field/events/${ev.id}/expenses`, { category: 'food', description: 'x', amount: 5 }, 'sup')).status, 400);
  // the north branch's event is invisible to this supervisor
  const northEvent = (await call('GET', '/api/field/today', null, 'north')).body.events[0];
  assert.equal((await call('POST', `/api/field/events/${northEvent.id}/expenses`, { category: 'labor', description: 'x', amount: 5 }, 'sup')).status, 404);
  // database-level proof (row-level security): even raw SQL as the supervisor sees no money tables
  await db.tx({ id: (await call('GET', '/api/auth/me', null, 'sup')).body.user.id, role: 'supervisor', scopeBranch: ids.main }, async (q) => {
    assert.equal((await q('SELECT count(*)::int n FROM payments'))[0].n, 0); assert.equal((await q('SELECT count(*)::int n FROM booking_services'))[0].n, 0);
    assert.equal((await q('SELECT count(*)::int n FROM bookings WHERE event_date <> venue_today()'))[0].n, 0);
    assert.equal((await q('SELECT count(*)::int n FROM bookings WHERE branch_id <> $1', [ids.main]))[0].n, 0);
  });
});

/* ------------------------------------------------------------------ accounts ------------------------------------------------------------------ */
test('user administration is owner-only; privilege changes end existing sessions; lockout after repeated failures', async () => {
  assert.equal((await call('GET', '/api/users', null, 'manager')).status, 403);
  assert.equal((await call('POST', '/api/users', { username: 'x', fullName: 'x', role: 'manager', branchId: ids.main, email: 'x@x.test' }, 'manager')).status, 403);
  assert.equal((await call('POST', '/api/users', { username: 'x', fullName: 'x', role: 'manager', email: 'x@x.test' }, 'owner')).status, 400, 'a manager needs a branch');
  assert.equal((await call('POST', '/api/users', { username: 'nocontact', fullName: 'x', role: 'supervisor', branchId: ids.main }, 'owner')).body.error, 'CONTACT_REQUIRED');
  const c = await call('POST', '/api/users', { username: 'temp.sup', fullName: 'مشرف مؤقت', role: 'supervisor', branchId: ids.north, email: 'temp@venue.test' }, 'owner');
  assert.equal(c.status, 200); assert.ok(c.body.password);
  assert.equal((await login('temp', 'temp.sup', c.body.password)).status, 200);
  assert.equal((await call('GET', '/api/field/today', null, 'temp')).status, 200);
  // the owner moves the account to another branch: the old token (bound to the old branch) is rejected
  assert.equal((await call('PUT', `/api/users/${c.body.id}`, { fullName: 'مشرف مؤقت', role: 'supervisor', branchId: ids.main, email: 'temp@venue.test' }, 'owner')).status, 200);
  assert.equal((await call('GET', '/api/field/today', null, 'temp')).status, 401);
  assert.equal((await login('temp', 'temp.sup', c.body.password)).body.user.branchId, ids.main);
  // an owner cannot lock themselves out
  const me = (await call('GET', '/api/auth/me', null, 'owner')).body.user;
  assert.equal((await call('PUT', `/api/users/${me.id}`, { fullName: 'x', role: 'manager', branchId: ids.main, email: 'owner@venue.test' }, 'owner')).body.error, 'SELF_LOCKOUT');
  // deactivation ends access immediately
  assert.equal((await call('PUT', `/api/users/${c.body.id}`, { fullName: 'x', role: 'supervisor', branchId: ids.main, email: 'temp@venue.test', isActive: false }, 'owner')).status, 200);
  assert.equal((await call('GET', '/api/field/today', null, 'temp')).status, 401);
  assert.equal((await login('temp', 'temp.sup', c.body.password)).status, 401);
  // lockout
  const c2 = await call('POST', '/api/users', { username: 'lock.me', fullName: 'x', role: 'supervisor', branchId: ids.main, email: 'lock@venue.test' }, 'owner');
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { username: 'lock.me', password: 'wrong' + i });
  assert.equal((await call('POST', '/api/auth/login', { username: 'lock.me', password: c2.body.password })).body.error, 'LOCKED');
  assert.ok((await call('GET', '/api/security/logins?failed=1', null, 'owner')).body.logins.find((l) => l.failure_reason === 'locked'));
});

test('language preference; active sessions can be listed and revoked by the owner', async () => {
  assert.equal((await call('PATCH', '/api/auth/lang', { lang: 'fr' }, 'owner')).status, 400);
  assert.equal((await call('PATCH', '/api/auth/lang', { lang: 'en' }, 'owner')).status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, 'owner')).body.user.lang, 'en'); await call('PATCH', '/api/auth/lang', { lang: 'ar' }, 'owner');
  await login('victim', 'manager.north');
  const s = (await call('GET', '/api/security/sessions', null, 'owner')).body.sessions;
  const victim = s.find((x) => x.username === 'manager.north' && x.device_info.includes('Chrome')); assert.ok(victim && victim.ip_address);
  assert.equal((await call('GET', '/api/auth/me', null, 'victim')).status, 200);
  assert.equal((await call('DELETE', `/api/security/sessions/${victim.id}`, null, 'manager')).status, 403);
  assert.equal((await call('DELETE', `/api/security/sessions/${victim.id}`, null, 'owner')).body.revoked, 1);
  assert.equal((await call('GET', '/api/auth/me', null, 'victim')).status, 401, 'a revoked token stops working immediately');
});

test('password recovery by e-mail and by phone; same answer for unknown accounts; code is single-use; sessions revoked', async () => {
  outbox.length = 0;
  const unknown = await call('POST', '/api/auth/forgot', { identifier: 'ghost@nowhere.test' });
  const known = await call('POST', '/api/auth/forgot', { identifier: 'MANAGER@venue.test' });
  assert.deepEqual(unknown.body, known.body); assert.equal(unknown.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(outbox.length, 1); assert.equal(outbox[0].channel, 'email'); assert.equal(outbox[0].to, 'manager@venue.test');
  assert.equal(JSON.stringify(known.body).includes(outbox[0].code), false, 'the code must never be in the HTTP answer');
  assert.equal((await call('POST', '/api/auth/reset', { identifier: 'manager@venue.test', code: '000000', password: 'NewPassw0rd' })).body.error, 'INVALID_CODE');
  assert.equal((await call('POST', '/api/auth/reset', { identifier: 'manager@venue.test', code: outbox[0].code, password: 'short' })).body.error, 'WEAK_PASSWORD');
  const code = outbox[0].code;
  assert.equal((await call('POST', '/api/auth/reset', { identifier: 'manager@venue.test', code, password: 'NewPassw0rd' })).status, 200);
  assert.equal((await call('POST', '/api/auth/reset', { identifier: 'manager@venue.test', code, password: 'Another1pass' })).body.error, 'INVALID_CODE');
  assert.equal((await call('GET', '/api/auth/me', null, 'manager')).status, 401, 'old sessions are revoked');
  assert.equal((await login('manager', 'manager', PW)).status, 401);
  assert.equal((await login('manager', 'manager', 'NewPassw0rd')).status, 200);
  outbox.length = 0;
  await call('POST', '/api/auth/forgot', { identifier: '0501112233' }); await new Promise((r) => setTimeout(r, 50));   // +966 50 111 2233 is the same number
  assert.equal(outbox[0].channel, 'sms');
  assert.equal((await call('POST', '/api/auth/reset', { identifier: '0501112233', code: outbox[0].code, password: 'OwnerNew1pass' })).status, 200);
  assert.equal((await login('owner', 'owner', 'OwnerNew1pass')).status, 200);
  assert.ok((await call('GET', '/api/security/logins?limit=100', null, 'owner')).body.logins.some((l) => l.event_type === 'password_reset'));
});

test('recovery code is invalidated after too many wrong attempts', async () => {
  outbox.length = 0; await call('POST', '/api/auth/forgot', { identifier: 'north@example.com' }); await new Promise((r) => setTimeout(r, 50));
  const good = outbox[0].code; const wrong = good === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/reset', { identifier: 'north@example.com', code: wrong, password: 'Whatever123' });
  assert.equal((await call('POST', '/api/auth/reset', { identifier: 'north@example.com', code: good, password: 'Whatever123' })).body.error, 'INVALID_CODE');
});

/* ------------------------------------------------------------------ business flows ------------------------------------------------------------------ */
test('contract lifecycle: create, double booking per hall, services added later bind to the contract number, receipts, instant recalculation', async () => {
  const day = ymd(50);
  const mk = (hallId, section) => call('POST', '/api/contracts', { hallId, eventDate: day, section, clientName: 'اختبار', clientPhone: '050', baseAmount: 10000, discount: 500, deposit: 2000, method: 'card' }, 'manager');
  const a = await mk(ids.grand, 'women'); assert.equal(a.status, 200); assert.match(a.body.contractNumber, /^C-\d{4}-\d{5}$/);
  assert.equal((await mk(ids.grand, 'both')).body.error, 'DOUBLE_BOOKING');
  assert.equal((await mk(ids.small, 'both')).status, 200, 'another hall is independent');
  const id = a.body.id;
  let d = (await call('GET', `/api/contracts/${id}`, null, 'manager')).body;
  assert.equal(d.contract.total_amount, 9500); assert.equal(d.contract.paid_total, 2000); assert.equal(d.payments[0].contract_number, a.body.contractNumber);
  const s = await call('POST', `/api/contracts/${id}/services`, { name: 'كوشة', quantity: 2, unitPrice: 1250 }, 'manager');
  assert.equal(s.body.contractNumber, a.body.contractNumber);
  assert.deepEqual(s.body.totals, { total_amount: 12000, paid_total: 2000, balance_due: 10000 });
  const p = await call('POST', `/api/contracts/${id}/payments`, { amount: 3000, method: 'cash' }, 'manager');
  assert.match(p.body.receiptNumber, /^R-\d{4}-\d{6}$/); assert.equal(p.body.contractNumber, a.body.contractNumber);
  assert.equal((await call('POST', `/api/contracts/${id}/payments`, { amount: 7000.01, method: 'cash' }, 'manager')).body.error, 'OVERPAY');
  d = (await call('GET', `/api/contracts/${id}`, null, 'manager')).body; assert.equal(d.contract.balance_due, 7000);
  assert.equal((await call('POST', '/api/contracts', { hallId: ids.grand, eventDate: ymd(-1), section: 'men', clientName: 'x', clientPhone: '1', baseAmount: 1 }, 'manager')).body.error, 'PAST_DATE');
  assert.equal((await call('POST', '/api/contracts', { hallId: ids.grand, eventDate: ymd(60), section: 'men', clientName: 'x', clientPhone: '1', baseAmount: -1 }, 'manager')).body.error, 'INVALID');
  // the contract belongs to MAIN: the owner sees it, the north manager does not
  assert.equal((await call('GET', `/api/contracts/${id}`, null, 'owner')).status, 200); assert.equal((await call('GET', `/api/contracts/${id}`, null, 'north')).status, 404);
});

test('same-day settlement: expenses -> net profit -> split; closure blocked until paid; atomic close; frozen afterwards', async () => {
  const d = (await call('GET', '/api/dashboard', null, 'manager')).body;
  const women = d.todays.find((t) => t.contract.section === 'women'); const id = women.contract.id;
  assert.equal(women.contract.balance_due, 10500); assert.equal(women.closure.canFinalize, false);
  const men = d.todays.find((t) => t.contract.section === 'men');
  assert.equal(men.contract.status, 'closed'); assert.equal(men.settlement.net_profit, 8900); assert.equal(men.settlement.rental_share, 5340); assert.equal(men.settlement.settled_on_event_day, true);
  // (the field supervisor already opened this draft earlier today by entering an expense)
  assert.equal(women.settlement?.status, 'draft');
  const open = { status: 200, body: { id: women.settlement.id } };
  assert.equal((await call('POST', `/api/contracts/${id}/settlement`, null, 'manager')).body.error, 'SETTLEMENT_EXISTS');
  const sid = open.body.id;
  for (const [category, description, amount] of [['labor', 'أجور 10 عمال', 1500], ['cleaning', 'نظافة', 500.5], ['consumables', 'مستهلكات', 499.5]]) {
    assert.equal((await call('POST', `/api/settlements/${sid}/expenses`, { category, description, amount }, 'manager')).status, 200);
  }
  let det = (await call('GET', `/api/contracts/${id}`, null, 'manager')).body;
  assert.equal(det.settlement.total_revenue, 19500); assert.equal(det.settlement.total_expenses, 2500); assert.equal(det.settlement.net_profit, 17000);
  assert.deepEqual([det.settlement.rental_share, det.settlement.marketing_share], [10200, 6800]);
  assert.deepEqual([det.preview.net, det.preview.rental, det.preview.marketing], [17000, 10200, 6800], 'JS preview equals the database');
  assert.equal((await call('DELETE', `/api/expenses/${det.settlement.expenses[2].id}`, null, 'manager')).status, 200);
  det = (await call('GET', `/api/contracts/${id}`, null, 'manager')).body; assert.equal(det.settlement.total_expenses, 2000.5);
  assert.equal((await call('POST', `/api/settlements/${sid}/finalize`, null, 'manager')).body.error, 'BALANCE_NOT_ZERO');
  assert.equal((await call('POST', `/api/contracts/${id}/payments`, { amount: 10500, method: 'cash' }, 'manager')).status, 200);
  const fin = await call('POST', `/api/settlements/${sid}/finalize`, null, 'manager');
  assert.equal(fin.status, 200); assert.equal(fin.body.settledOnEventDay, true); assert.equal(fin.body.netProfit, 17499.5);
  assert.equal((await call('GET', `/api/contracts/${id}`, null, 'manager')).body.contract.status, 'closed');
  assert.equal((await call('POST', `/api/contracts/${id}/services`, { name: 'متأخر', unitPrice: 5 }, 'manager')).body.error, 'FROZEN');
  assert.equal((await call('POST', `/api/settlements/${sid}/expenses`, { category: 'other', description: 'x', amount: 5 }, 'manager')).body.error, 'FROZEN');
});

test('owner-exclusive: profit-split percentages, financial overrides on closed events, reopening', async () => {
  assert.equal((await call('PUT', '/api/settings/split', { rental: 70, marketing: 30 }, 'manager')).body.error, 'FORBIDDEN');
  assert.equal((await call('PUT', '/api/settings/split', { rental: 70, marketing: 40 }, 'owner')).body.error, 'SPLIT_SUM');
  assert.equal((await call('PUT', '/api/settings/split', { rental: 55, marketing: 45 }, 'owner')).status, 200);
  const done = (await call('GET', '/api/dashboard', null, 'owner')).body.todays.find((t) => t.settlement?.status === 'finalized' && t.contract.branch_id === ids.main);
  assert.equal(done.settlement.rental_pct, 60, 'history is not rewritten by a new default split');
  const sid = done.settlement.id;
  assert.equal((await call('POST', `/api/settlements/${sid}/reopen`, null, 'manager')).body.error, 'FORBIDDEN');
  assert.equal((await call('PUT', `/api/settlements/${sid}`, { rentalPct: 50, marketingPct: 50 }, 'manager')).body.error, 'FORBIDDEN');
  assert.equal((await call('PUT', `/api/settlements/${sid}`, { rentalPct: 50, marketingPct: 50, revenueOverride: 5000 }, 'owner')).body.error, 'OVERRIDE_REASON');
  assert.equal((await call('PUT', `/api/settlements/${sid}`, { rentalPct: 50, marketingPct: 50, revenueOverride: 10000, reason: 'خصم متفق عليه' }, 'owner')).status, 200);
  const after = (await call('GET', `/api/contracts/${done.contract.id}`, null, 'owner')).body.settlement;
  assert.equal(after.total_revenue, 10000); assert.equal(after.rental_share, after.net_profit / 2);
  // the closed contract's financials changed by the owner => CRITICAL on the security dashboard
  const crit = (await call('GET', '/api/audit?severity=critical', null, 'owner')).body.entries;
  assert.ok(crit.find((e) => e.table_name === 'profit_split_settings') && crit.find((e) => e.table_name === 'event_settlements' && e.contract_number === done.contract.contract_number));
});

/* ------------------------------------------------------------------ audit & security dashboard ------------------------------------------------------------------ */
test('soft delete only: archived with old/new values, flagged on the security dashboard, visible to the owner across branches', async () => {
  const c = (await call('POST', '/api/contracts', { hallId: ids.grand, eventDate: ymd(80), section: 'men', clientName: 'حذف', clientPhone: '1', baseAmount: 1000, deposit: 500 }, 'manager')).body;
  const pid = (await call('GET', `/api/contracts/${c.id}`, null, 'manager')).body.payments[0].id;
  assert.equal((await call('DELETE', `/api/payments/${pid}`, null, 'manager')).status, 200);
  const [row] = await db.system('SELECT deleted_at, deleted_by FROM payments WHERE id = $1', [pid]); assert.ok(row.deleted_at && row.deleted_by, 'the row is still there');
  const deleted = (await call('GET', '/api/security/deleted', null, 'owner')).body.items;
  assert.ok(deleted.find((i) => i.table_name === 'payments' && Number(i.record_id) === pid && i.deleted_by_name === 'مدير الفرع الرئيسي' && i.amount === 500));
  assert.ok(deleted.find((i) => i.table_name === 'event_expenses' && i.description === 'إدخال خاطئ'), 'seeded voided expense');
  const log = (await call('GET', '/api/audit?limit=300', null, 'owner')).body.entries;
  const e = log.find((x) => x.action === 'SOFT_DELETE' && x.table_name === 'payments' && x.record_id === pid);
  assert.equal(e.severity, 'warning'); assert.equal(e.old_value.deleted_at, null); assert.ok(e.new_value.deleted_at); assert.equal(e.branch_id, ids.main); assert.ok(e.user_name && e.timestamp);
  assert.ok((await call('GET', '/api/audit?severity=flagged', null, 'owner')).body.entries.every((x) => x.severity !== 'info'));
  assert.ok((await call('GET', `/api/audit?branch=${ids.north}`, null, 'owner')).body.entries.every((x) => x.branch_id === ids.north));
  assert.equal(JSON.stringify(log).includes('password_hash'), false, 'secrets never reach the audit archive');
  const ov = (await call('GET', '/api/security/overview', null, 'owner')).body;
  assert.ok(ov.softDeleted >= 2 && ov.warnings7d >= 1 && ov.critical7d >= 1 && ov.failedLogins24h >= 1 && ov.activeSessions >= 1 && ov.securityEvents7d >= 1, JSON.stringify(ov));
  // no path to a hard delete, even for raw SQL as the application role
  await db.tx({ id: 1, role: 'owner', scopeBranch: null }, async (q) => { await assert.rejects(q('DELETE FROM payments WHERE id = $1', [pid]), /permission denied/); });
  await assert.rejects(db.system('DELETE FROM audit_logs'), /append-only/);
  await assert.rejects(db.system('TRUNCATE audit_logs'), /append-only/);
  assert.equal((await call('POST', `/api/contracts/${c.id}/cancel`, null, 'manager')).status, 200);
});

test('profit-split arithmetic matches PostgreSQL for awkward values', async () => {
  const cases = [[10000, 3000, 60], [1234.56, 100.01, 33.33], [999.99, 0.01, 12.5], [100, 250.75, 60], [0.05, 0, 50], [77.77, 7.07, 66.67]];
  for (const [revenue, expenses, pct] of cases) {
    const js = computeSplit({ revenue, expenses, rentalPct: pct });
    const [r] = await db.system(`SELECT (round(($1::numeric - $2::numeric) * $3::numeric / 100, 2)) AS rental, (($1::numeric - $2::numeric) - round(($1::numeric - $2::numeric) * $3::numeric / 100, 2)) AS marketing`, [revenue, expenses, pct]);
    assert.equal(js.rental, r.rental, `rental ${revenue}/${expenses}/${pct}`); assert.equal(js.marketing, r.marketing, `marketing ${revenue}/${expenses}/${pct}`);
  }
});

test('static files: path traversal blocked; API 404/415 are clean; logout ends the session and is journalled', async () => {
  assert.equal((await fetch(base + '/..%2fapi%2fdb.js')).status === 200, false);
  assert.equal((await call('GET', '/api/nope', null, 'owner')).status, 404);
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x=1' });
  assert.equal(r.status, 415);
  assert.equal((await call('POST', '/api/auth/logout', null, 'sup')).status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, 'sup')).status, 401);
  assert.ok((await call('GET', '/api/security/logins?limit=30', null, 'owner')).body.logins.some((l) => l.event_type === 'logout'));
});
