'use strict';
/* Input validation helpers shared by all bounded contexts. Every failure is a 400 INVALID. */
const { ApiError } = require('./errors');
const bad = (field) => new ApiError(400, 'INVALID', `invalid value: ${field}`);

const str = (v, field, max = 150) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw bad(field);
  return v.trim();
};
const optStr = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, field, { min = 0, max = 1e9, gt = false } = {}) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || (gt ? n <= min : n < min) || n > max) throw bad(field);
  return Math.round(n * 100) / 100;
};
const int = (v, field, opts = {}) => {
  const n = num(v, field, opts); if (!Number.isInteger(n)) throw bad(field); return n;
};
const id = (v, field = 'id') => {
  const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 9e15) throw bad(field); return n;
};
const date = (v, field) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) throw bad(field);
  return v;
};
const oneOf = (v, list, field) => { if (!list.includes(v)) throw bad(field); return v; };
const month = (v, field = 'month') => { if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw bad(field); return v; };

module.exports = { str, optStr, num, int, id, date, oneOf, month };
