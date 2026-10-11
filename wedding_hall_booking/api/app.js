'use strict';
/* HTTP composition root: wires the bounded contexts' routes, authentication, security headers and static files. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./kernel/db');
const { ApiError, fromDb } = require('./kernel/errors');
const rbac = require('./modules/rbac/service');
const { can } = require('./modules/rbac/permissions');

const ROUTES = [
  ...require('./modules/rbac/routes').routes,
  ...require('./modules/venue/routes').routes,
  ...require('./modules/bookings/routes').routes,
  ...require('./modules/services/routes').routes,
  ...require('./modules/settlement/routes').routes,
  ...require('./modules/operations/routes').routes,
  ...require('./modules/security/routes').routes,
].map((r) => ({ ...r, re: new RegExp('^' + r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') }));
// static segments must win over parameters (e.g. /api/contracts/search before /api/contracts/:id)
ROUTES.sort((a, b) => (a.path.includes(':') ? 1 : 0) - (b.path.includes(':') ? 1 : 0));

const COOKIE = 'qasr_sid';
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, '..', 'web', 'out');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.map': 'application/json' };
const SECURITY = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const parseCookies = (h) => Object.fromEntries(String(h || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const clientIp = (req) => (process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
const secureCookie = (req) => process.env.COOKIE_SECURE === '1' || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');

function send(res, status, body, headers = {}) { res.writeHead(status, { ...SECURITY, ...headers }); res.end(body); }
const sendJSON = (res, status, obj, extra = {}) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new ApiError(413, 'TOO_LARGE')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!size) return resolve({});
      try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(b && typeof b === 'object' && !Array.isArray(b) ? b : {}); } catch { reject(new ApiError(400, 'INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------------------------------------
 * INSPECTION MIDDLEWARE — runs on every API request, before any SQL is executed on business data.
 *   1. authenticate : verify the JWT signature/expiry, then re-check it against the session + user rows
 *                     (claims: sub, role, branch_id | "ALL", sid).
 *   2. authorise    : the route's permission must be granted to the role (RBAC matrix in modules/rbac/permissions.js).
 *   3. branch bound : a branch-bound user may not name another branch in the query or body (BRANCH_VIOLATION).
 *   4. bind         : ctx.tx() opens a transaction as { id, role, scopeBranch }. The database then applies row-level
 *                     security, so even a query that forgets its WHERE clause cannot return another branch's rows.
 * Every denial is written to security_events and shown on the Super Admin security page.
 * ------------------------------------------------------------------------------------------- */
const BRANCH_KEYS = ['branch', 'branchId', 'branch_id'];
function assertBranchBoundary(user, query, body) {
  if (user.role === 'owner') return;
  for (const src of [query, body]) {
    for (const k of BRANCH_KEYS) {
      if (src[k] !== undefined && src[k] !== null && src[k] !== '' && String(src[k]).toUpperCase() !== 'ALL' && String(src[k]) !== String(user.branch_id)) {
        throw new ApiError(403, 'BRANCH_VIOLATION', `branch ${src[k]} is outside your assigned branch`);
      }
    }
  }
}

async function handleApi(req, res, url) {
  const route = ROUTES.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route) throw new ApiError(404, 'NOT_FOUND');
  // CSRF: the session cookie is SameSite=Strict and mutating calls must be JSON (browsers cannot send that cross-site without a CORS preflight)
  if (req.method !== 'GET' && Number(req.headers['content-length'] || 0) > 0 && !/^application\/json/.test(req.headers['content-type'] || '')) throw new ApiError(415, 'UNSUPPORTED_MEDIA');
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
  const token = parseCookies(req.headers.cookie)[COOKIE] || '';
  const out = [];   // Set-Cookie headers
  const query = Object.fromEntries(url.searchParams);
  const ctx = {
    req, res, body, token, ip: clientIp(req), query, params: { ...(route.re.exec(url.pathname).groups || {}) }, user: null, scopeBranch: null, sessionId: null,
    setSession: (t, maxAge) => out.push(`${COOKIE}=${encodeURIComponent(t)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie(req) ? '; Secure' : ''}`),
    clearSession: () => out.push(`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie(req) ? '; Secure' : ''}`),
  };
  if (!route.public || token) {
    const auth = token ? await rbac.authenticate(token) : null;
    if (auth) { ctx.user = auth.user; ctx.scopeBranch = auth.scopeBranch; ctx.sessionId = auth.sessionId; req._actor = auth.user; }
    else if (!route.public) { req._invalidToken = !!token; throw new ApiError(401, 'UNAUTHENTICATED'); }
  }
  if (!route.public) {
    if (route.perm && !can(ctx.user.role, route.perm)) throw new ApiError(403, 'FORBIDDEN', `permission required: ${route.perm}`);
    assertBranchBoundary(ctx.user, query, body);
    const actor = { id: ctx.user.id, role: ctx.user.role, scopeBranch: ctx.scopeBranch };
    ctx.tx = (fn) => db.tx(actor, fn);                      // every business operation is one ACID transaction, attributed and branch-scoped
  }
  const result = await route.handler(ctx);
  sendJSON(res, 200, result, out.length ? { 'Set-Cookie': out } : {});
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { throw new ApiError(400, 'INVALID'); }
  const root = path.resolve(WEB_DIR);
  const candidates = [rel, rel.replace(/\/$/, '') + '.html', path.posix.join(rel, 'index.html')];
  for (const c of candidates) {
    const file = path.resolve(root, '.' + c);
    if (file !== root && !file.startsWith(root + path.sep)) continue;       // path traversal guard
    try {
      if (!fs.statSync(file).isFile()) continue;
      const immutable = file.includes(`${path.sep}_next${path.sep}static${path.sep}`);
      return send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    } catch { /* try next candidate */ }
  }
  if (!fs.existsSync(path.join(root, 'index.html'))) return send(res, 503, 'Frontend not built. Run: npm run build:web', { 'Content-Type': 'text/plain; charset=utf-8' });
  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url); else serveStatic(req, res, url);
    } catch (e) {
      let err = e instanceof ApiError ? e : fromDb(e);
      if (!err) { console.error(e); err = new ApiError(500, 'INTERNAL'); }
      // security journal: denials and boundary violations are recorded for the Super Admin
      if (url.pathname.startsWith('/api/')) {
        const u = req._actor;
        if (err.status === 403 && u) rbac.logSecurityEvent({ userId: u.id, type: err.code === 'BRANCH_VIOLATION' ? 'BRANCH_VIOLATION' : 'PERMISSION_DENIED', method: req.method, path: url.pathname, ip: clientIp(req), branchId: u.branch_id, detail: err.message });
        else if (err.status === 401 && req._invalidToken) rbac.logSecurityEvent({ type: 'INVALID_TOKEN', method: req.method, path: url.pathname, ip: clientIp(req), detail: 'rejected session token' });
      }
      if (!res.headersSent) sendJSON(res, err.status, { error: err.code, message: err.status === 500 ? 'internal error' : err.message });
    }
  });
}
module.exports = { createServer };
