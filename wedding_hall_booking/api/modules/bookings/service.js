'use strict';
/* Bookings bounded context: contracts, receipts (سندات القبض), calendar. */
const v = require('../../kernel/validate');
const { ApiError } = require('../../kernel/errors');

const SECTIONS = ['women', 'men', 'both'];
const METHODS = ['cash', 'card', 'transfer'];

const listHalls = (q) => q(`SELECT id, branch_id, name_ar, name_en, capacity_men, capacity_women, base_price, is_active FROM halls WHERE deleted_at IS NULL ORDER BY id`);

async function createContract(q, input) {
  const base = v.num(input.baseAmount, 'baseAmount'), discount = v.num(input.discount ?? 0, 'discount'), deposit = v.num(input.deposit ?? 0, 'deposit');
  if (discount > base) throw new ApiError(400, 'DISCOUNT');
  if (deposit > base - discount) throw new ApiError(400, 'OVERPAY');
  const [b] = await q(`INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount, discount) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, contract_number`,
    [v.id(input.hallId, 'hallId'), v.date(input.eventDate, 'eventDate'), v.oneOf(input.section, SECTIONS, 'section'),
     v.str(input.clientName, 'clientName'), v.str(input.clientPhone, 'clientPhone', 30), base, discount]);
  if (deposit > 0) await recordPayment(q, b.id, { amount: deposit, method: input.method || 'cash', note: 'deposit' });
  return { id: b.id, contractNumber: b.contract_number };
}

/* Issue a receipt. It is bound to the contract number by the database and may not exceed the balance due. */
async function recordPayment(q, bookingId, input) {
  const [p] = await q(`INSERT INTO payments (booking_id, amount, method, note) VALUES ($1,$2,$3,$4) RETURNING id, receipt_number, contract_number`,
    [bookingId, v.num(input.amount, 'amount', { gt: true }), v.oneOf(input.method, METHODS, 'method'), v.optStr(input.note, 200)]);
  return { id: p.id, receiptNumber: p.receipt_number, contractNumber: p.contract_number };
}

async function voidPayment(q, paymentId) {
  const rows = await q(`UPDATE payments SET deleted_at = now(), deleted_by = app_user_id() WHERE id = $1 AND deleted_at IS NULL RETURNING booking_id`, [paymentId]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
  return rows[0].booking_id;
}

async function cancelContract(q, bookingId, role) {
  const [c] = await q('SELECT status, paid_total FROM v_contracts WHERE id = $1', [bookingId]);
  if (!c) throw new ApiError(404, 'NOT_FOUND');
  if (c.paid_total > 0 && role !== 'owner') throw new ApiError(409, 'HAS_RECEIPTS');   // money was taken: the owner decides
  await q(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
}

const search = (q, text) => q('SELECT * FROM search_contracts($1, 10)', [v.str(text, 'q', 60)]);

async function calendar(q, { month, hallId }) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`, last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const events = await q(`SELECT id, contract_number, hall_id, client_name, event_date, section, status, balance_due, settlement_due_today, settlement_overdue
                          FROM v_contracts WHERE event_date BETWEEN $1 AND $2 AND status <> 'cancelled' AND ($3::bigint IS NULL OR hall_id = $3) ORDER BY event_date, id`,
    [first, last, hallId ?? null]);
  const [{ today }] = await q('SELECT venue_today() AS today');
  return { month, today, events };
}

module.exports = { listHalls, createContract, recordPayment, voidPayment, cancelContract, search, calendar, SECTIONS, METHODS };
