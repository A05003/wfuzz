// Verifies the UI dictionaries: every key used by the components exists in BOTH languages, both languages have
// identical keys, and the {placeholders} agree. Run: npm run check:i18n
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(root, 'lib/dict.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { dict } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(path.join(d, e.name))) : e.name.match(/\.(tsx?)$/) ? [path.join(d, e.name)] : []));
const files = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(root, d))).filter((f) => !f.endsWith('dict.ts'));
const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const used = new Set([...text.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]));
// dynamic keys: prefix -> the values the code can produce
const dynamic = {
  section: ['women', 'men', 'both'], status: ['confirmed', 'closed', 'cancelled', 'overdue', 'today'], method: ['cash', 'card', 'transfer'], cat: ['labor', 'cleaning', 'consumables', 'other'],
  role: ['owner', 'manager', 'supervisor'], sev: ['info', 'warning', 'critical', 'flagged'], act: ['CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE'],
  tbl: ['bookings', 'booking_services', 'payments', 'event_settlements', 'event_expenses', 'profit_split_settings', 'halls', 'branches', 'users', 'venue_settings'],
  evt: ['login', 'logout', 'recovery_request', 'password_reset'], fail: ['bad_credentials', 'locked', 'inactive', 'branch_mismatch', 'rate_limited', 'unknown_account', 'unknown'],
  sevt: ['PERMISSION_DENIED', 'BRANCH_VIOLATION', 'INVALID_TOKEN', 'SESSION_REVOKED', 'UNAUTHENTICATED_ACCESS'], 'settle.status': ['draft', 'finalized'],
  chk: ['catering', 'screens', 'sound', 'seating', 'cleaning'],
  err: ['INTERNAL', 'NETWORK', 'INVALID', 'UNAUTHENTICATED', 'BAD_CREDENTIALS', 'LOCKED', 'RATE_LIMITED', 'BRANCH_MISMATCH', 'FORBIDDEN', 'OWNER_ONLY', 'BRANCH_VIOLATION', 'NOT_FOUND', 'DOUBLE_BOOKING', 'OVERPAY', 'PAST_DATE', 'DISCOUNT', 'SPLIT_SUM', 'OVERRIDE_REASON', 'FROZEN', 'EVENT_PASSED', 'TOO_EARLY', 'BALANCE_NOT_ZERO', 'SPLIT_NOT_SET', 'HAS_RECEIPTS', 'SETTLEMENT_EXISTS', 'DUPLICATE', 'RULE', 'WEAK_PASSWORD', 'INVALID_CODE', 'PASSWORD_MISMATCH', 'CONTACT_REQUIRED', 'SELF_LOCKOUT', 'TOO_LARGE', 'UNSUPPORTED_MEDIA', 'INVALID_JSON', 'METHOD_NOT_ALLOWED'],
};
for (const [p, vs] of Object.entries(dynamic)) for (const v of vs) used.add(`${p}.${v}`);
for (const k of ['login.f1', 'login.f2', 'login.f3', 'login.f4']) used.add(k);

let bad = 0; const fail = (m) => { console.error('✗ ' + m); bad++; };
for (const l of ['ar', 'en']) for (const k of used) if (!(k in dict[l])) fail(`missing in ${l}: ${k}`);
for (const k of Object.keys(dict.ar)) if (!(k in dict.en)) fail(`only in ar: ${k}`);
for (const k of Object.keys(dict.en)) if (!(k in dict.ar)) fail(`only in en: ${k}`);
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const k of Object.keys(dict.ar)) if (dict.en[k] && ph(dict.ar[k]) !== ph(dict.en[k])) fail(`placeholder mismatch: ${k}`);
const unused = Object.keys(dict.ar).filter((k) => !used.has(k) && k !== 'currency');
console.log(`${used.size} keys in use, ${Object.keys(dict.ar).length} defined (ar) / ${Object.keys(dict.en).length} (en), ${unused.length} unreferenced`);
if (unused.length) console.log('unreferenced:', unused.join(' '));
if (bad) process.exit(1); console.log('i18n OK');
