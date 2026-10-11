'use strict';
const svc = require('./service');
const db = require('../../kernel/db');
const v = require('../../kernel/validate');

const routes = [
  { method: 'GET', path: '/api/public/venue', public: true, handler: async () => ({ venue: await svc.publicInfo(db) }) },   // login-page branding
  { method: 'GET', path: '/api/venue', perm: 'booking.read', handler: async (ctx) => ({ venue: await ctx.tx((q) => svc.get(q)) }) },
  { method: 'PUT', path: '/api/venue', perm: 'venue.write', handler: (ctx) => ctx.tx(async (q) => { await svc.update(q, ctx.body); return { venue: await svc.get(q) }; }) },
  { method: 'GET', path: '/api/branches', perm: 'event.view.active', handler: async (ctx) => ({ branches: await ctx.tx((q) => svc.listBranches(q)) }) },   // row-level security: a branch user sees only their own
  { method: 'POST', path: '/api/branches', perm: 'branch.write', handler: (ctx) => ctx.tx(async (q) => ({ id: await svc.createBranch(q, ctx.body) })) },
  { method: 'PUT', path: '/api/branches/:id', perm: 'branch.write', handler: (ctx) => ctx.tx(async (q) => { await svc.updateBranch(q, v.id(ctx.params.id), ctx.body); return { ok: true }; }) },
  { method: 'POST', path: '/api/halls', perm: 'hall.write', handler: (ctx) => ctx.tx(async (q) => ({ id: await svc.createHall(q, ctx.body) })) },
  { method: 'PUT', path: '/api/halls/:id', perm: 'hall.write', handler: (ctx) => ctx.tx(async (q) => { await svc.updateHall(q, v.id(ctx.params.id), ctx.body); return { ok: true }; }) },
];
module.exports = { routes };
