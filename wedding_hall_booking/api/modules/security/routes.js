'use strict';
const svc = require('./service');
const rbac = require('../rbac/service');
const v = require('../../kernel/validate');

const P = 'audit.read';   // Super Admin only
const routes = [
  { method: 'GET', path: '/api/security/overview', perm: P, handler: (ctx) => ctx.tx((q) => svc.overview(q)) },
  { method: 'GET', path: '/api/security/logins', perm: P, handler: async (ctx) => ({ logins: await ctx.tx((q) => svc.logins(q, {
      limit: svc.lim(ctx.query.limit), user: ctx.query.user ? v.id(ctx.query.user, 'user') : null, onlyFailed: ctx.query.failed === '1' })) }) },
  { method: 'GET', path: '/api/security/events', perm: P, handler: async (ctx) => ({ events: await ctx.tx((q) => svc.events(q, svc.lim(ctx.query.limit))) }) },
  { method: 'GET', path: '/api/security/deleted', perm: P, handler: async (ctx) => ({ items: await ctx.tx((q) => svc.deleted(q, svc.lim(ctx.query.limit))) }) },
  { method: 'GET', path: '/api/security/branches', perm: P, handler: async (ctx) => ({ branches: await ctx.tx((q) => svc.branchFinancials(q)) }) },
  { method: 'GET', path: '/api/security/sessions', perm: P, handler: async (ctx) => ({ sessions: await ctx.tx((q) => svc.sessions(q)) }) },
  { method: 'DELETE', path: '/api/security/sessions/:id', perm: 'session.revoke', async handler(ctx) {
      const r = await rbac.revokeSession(v.id(ctx.params.id));
      await rbac.logSecurityEvent({ userId: ctx.user.id, type: 'SESSION_REVOKED', method: 'DELETE', path: ctx.req.url, ip: ctx.ip, detail: `session ${ctx.params.id}` });
      return { revoked: r.length };
  } },
  { method: 'GET', path: '/api/audit', perm: P, handler: async (ctx) => ({ entries: await ctx.tx((q) => svc.audit(q, {
      contract: ctx.query.contract ? v.str(ctx.query.contract, 'contract', 40) : null,
      severity: ctx.query.severity ? v.oneOf(ctx.query.severity, ['info', 'warning', 'critical', 'flagged'], 'severity') : null,
      branch: ctx.query.branch ? v.id(ctx.query.branch, 'branch') : null, limit: svc.lim(ctx.query.limit) })) }) },
];
module.exports = { routes };
