'use strict';
const svc = require('./service');
const { ApiError } = require('../../kernel/errors');
const { oneOf } = require('../../kernel/validate');

const routes = [
  { method: 'POST', path: '/api/auth/login', public: true, async handler(ctx) {
      const r = await svc.login({ username: ctx.body.username, password: ctx.body.password, branch: ctx.body.branch, userAgent: ctx.req.headers['user-agent'], ip: ctx.ip });
      ctx.setSession(r.token, r.maxAge);
      return { user: r.user };
  } },
  { method: 'POST', path: '/api/auth/logout', public: true, async handler(ctx) { await svc.logout(ctx.token, ctx.ip, ctx.req.headers['user-agent']); ctx.clearSession(); return { ok: true }; } },
  { method: 'GET', path: '/api/auth/me', async handler(ctx) { return { user: svc.publicUser(ctx.user, ctx.scopeBranch, await svc.listBranches()) }; } },
  { method: 'PATCH', path: '/api/auth/lang', async handler(ctx) {
      const lang = oneOf(ctx.body.lang, ['ar', 'en'], 'lang'); await svc.setLang(ctx.user.id, lang); return { ok: true, lang };
  } },
  // the owner's branch switcher: { branch: 'ALL' | <id> }
  { method: 'PUT', path: '/api/auth/scope', async handler(ctx) {
      const scope = await svc.setScope(ctx.sessionId, ctx.user, ctx.body.branch); return { scopeBranch: scope };
  } },
  { method: 'POST', path: '/api/auth/forgot', public: true, async handler(ctx) {
      await svc.requestRecovery({ identifier: ctx.body.identifier, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] }); return { ok: true };   // identical answer for known and unknown accounts
  } },
  { method: 'POST', path: '/api/auth/reset', public: true, async handler(ctx) {
      await svc.resetPassword({ identifier: ctx.body.identifier, code: ctx.body.code, password: ctx.body.password, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] }); return { ok: true };
  } },
  { method: 'GET', path: '/api/public/branches', public: true, async handler() {
      return { branches: (await svc.listBranches()).filter((b) => b.is_active).map((b) => ({ id: b.id, name_ar: b.name_ar, name_en: b.name_en })) };   // for the login form's branch selector
  } },
];
module.exports = { routes };

/* account administration (owner) */
const users = require('./users');
const v = require('../../kernel/validate');
const db = require('../../kernel/db');
routes.push(
  { method: 'GET', path: '/api/users', perm: 'user.write', handler: async (ctx) => ({ users: await ctx.tx((q) => users.list(q)) }) },
  { method: 'POST', path: '/api/users', perm: 'user.write', handler: (ctx) => ctx.tx((q) => users.create(q, ctx.body)) },
  { method: 'PUT', path: '/api/users/:id', perm: 'user.write', handler: (ctx) => ctx.tx(async (q) => { await users.update(q, v.id(ctx.params.id), ctx.body, Number(ctx.user.id)); return { ok: true }; }) },
);
