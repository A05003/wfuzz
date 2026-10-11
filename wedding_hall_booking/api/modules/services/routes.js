'use strict';
const svc = require('./service');
const v = require('../../kernel/validate');

const routes = [
  { method: 'GET', path: '/api/services/catalog', perm: 'booking.read', handler: async (ctx) => ({ services: await ctx.tx((q) => svc.catalog(q)) }) },
  { method: 'POST', path: '/api/contracts/:id/services', perm: 'service.write', handler: (ctx) => ctx.tx((q) => svc.addToContract(q, v.id(ctx.params.id), ctx.body)) },
  { method: 'DELETE', path: '/api/services/:id', perm: 'service.write', handler: (ctx) => ctx.tx(async (q) => ({ bookingId: await svc.remove(q, v.id(ctx.params.id)) })) },
];
module.exports = { routes };
