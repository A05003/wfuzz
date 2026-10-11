'use strict';
const svc = require('./service');
const v = require('../../kernel/validate');

const routes = [
  { method: 'POST', path: '/api/contracts/:id/settlement', perm: 'settlement.open', handler: (ctx) => ctx.tx(async (q) => ({ id: await svc.open(q, v.id(ctx.params.id)) })) },
  { method: 'POST', path: '/api/settlements/:id/expenses', perm: 'expense.write', handler: (ctx) => ctx.tx(async (q) => ({ id: await svc.addExpense(q, v.id(ctx.params.id), ctx.body) })) },
  { method: 'DELETE', path: '/api/expenses/:id', perm: 'expense.write', handler: (ctx) => ctx.tx(async (q) => ({ settlementId: await svc.voidExpense(q, v.id(ctx.params.id)) })) },
  { method: 'POST', path: '/api/settlements/:id/finalize', perm: 'settlement.finalize', handler: (ctx) => ctx.tx((q) => svc.finalize(q, v.id(ctx.params.id))) },
  { method: 'POST', path: '/api/settlements/:id/reopen', perm: 'settlement.reopen', handler: (ctx) => ctx.tx(async (q) => ({ bookingId: await svc.reopen(q, v.id(ctx.params.id)) })) },
  { method: 'PUT', path: '/api/settlements/:id', perm: 'override.write', handler: (ctx) => ctx.tx(async (q) => ({ bookingId: await svc.ownerAdjust(q, v.id(ctx.params.id), ctx.body) })) },
  { method: 'GET', path: '/api/settings/split', perm: 'booking.read', handler: async (ctx) => ({ split: await ctx.tx((q) => svc.getSplit(q)) }) },
  { method: 'PUT', path: '/api/settings/split', perm: 'split.write', handler: (ctx) => ctx.tx(async (q) => { await svc.setSplit(q, ctx.body); return { split: await svc.getSplit(q) }; }) },
];
module.exports = { routes };
