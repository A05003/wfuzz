'use strict';
const svc = require('./service');
const read = require('../readmodels');
const v = require('../../kernel/validate');

const routes = [
  { method: 'GET', path: '/api/dashboard', perm: 'booking.read', handler: (ctx) => ctx.tx((q) => read.dashboard(q)) },
  { method: 'GET', path: '/api/halls', perm: 'event.view.active', handler: async (ctx) => ({ halls: await ctx.tx((q) => svc.listHalls(q)) }) },
  { method: 'GET', path: '/api/calendar', perm: 'booking.read', handler: (ctx) => ctx.tx((q) =>
      svc.calendar(q, { month: v.month(ctx.query.month), hallId: ctx.query.hall ? v.id(ctx.query.hall, 'hall') : null })) },
  { method: 'GET', path: '/api/contracts/search', perm: 'booking.read', handler: async (ctx) => ({ results: await ctx.tx((q) => svc.search(q, ctx.query.q)) }) },
  { method: 'GET', path: '/api/contracts/:id', perm: 'booking.read', handler: (ctx) => ctx.tx((q) => read.contractDetail(q, v.id(ctx.params.id))) },
  { method: 'POST', path: '/api/contracts', perm: 'booking.write', handler: (ctx) => ctx.tx((q) => svc.createContract(q, ctx.body)) },
  { method: 'POST', path: '/api/contracts/:id/cancel', perm: 'booking.write', handler: (ctx) => ctx.tx(async (q) => { await svc.cancelContract(q, v.id(ctx.params.id), ctx.user.role); return { ok: true }; }) },
  { method: 'POST', path: '/api/contracts/:id/payments', perm: 'payment.write', handler: (ctx) => ctx.tx((q) => svc.recordPayment(q, v.id(ctx.params.id), ctx.body)) },
  { method: 'DELETE', path: '/api/payments/:id', perm: 'payment.write', handler: (ctx) => ctx.tx(async (q) => ({ bookingId: await svc.voidPayment(q, v.id(ctx.params.id)) })) },   // soft delete, archived in audit_logs
];
module.exports = { routes };
