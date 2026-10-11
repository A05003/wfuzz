'use strict';
const svc = require('./service');
const v = require('../../kernel/validate');

const routes = [
  { method: 'GET', path: '/api/field/today', perm: 'event.view.active', handler: async (ctx) => ({ events: await ctx.tx((q) => svc.todayEvents(q)) }) },
  { method: 'POST', path: '/api/field/events/:id/checklist/init', perm: 'checklist.write', handler: (ctx) => ctx.tx((q) => svc.initChecklist(q, v.id(ctx.params.id))) },
  { method: 'POST', path: '/api/field/events/:id/checklist', perm: 'checklist.write', handler: (ctx) => ctx.tx(async (q) => ({ id: await svc.addItem(q, v.id(ctx.params.id), ctx.body) })) },
  { method: 'PATCH', path: '/api/checklist/:id', perm: 'checklist.write', handler: (ctx) => ctx.tx(async (q) => { await svc.setItem(q, v.id(ctx.params.id), ctx.body); return { ok: true }; }) },
  { method: 'POST', path: '/api/field/events/:id/expenses', perm: 'expense.write', handler: (ctx) => ctx.tx((q) => svc.addExpense(q, v.id(ctx.params.id), ctx.body)) },
];
module.exports = { routes };
