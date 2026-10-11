'use strict';
/* Post-Event Settlement bounded context (إغلاق وتصفية الحفل المالي). All commands run inside the caller's
 * transaction (db.tx), which is attributed to a user so every change lands in audit_logs. */
const v = require('../../kernel/validate');
const { ApiError } = require('../../kernel/errors');

const CATEGORIES = ['labor', 'cleaning', 'consumables', 'other'];

async function getForBooking(q, bookingId) {
  const [s] = await q('SELECT * FROM event_settlements WHERE booking_id = $1 AND deleted_at IS NULL', [bookingId]);
  if (!s) return null;
  s.expenses = await q(`SELECT id, category, description, amount, spent_on FROM event_expenses WHERE settlement_id = $1 AND deleted_at IS NULL ORDER BY id`, [s.id]);
  return s;
}

/* Opens a draft settlement. The split percentages are copied from the owner's configuration by the database. */
async function open(q, bookingId) {
  const [s] = await q('INSERT INTO event_settlements (booking_id) VALUES ($1) RETURNING id', [bookingId]);
  return s.id;
}

async function addExpense(q, settlementId, input) {
  const [e] = await q(`INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES ($1,$2,$3,$4) RETURNING id`,
    [settlementId, v.oneOf(input.category, CATEGORIES, 'category'), v.str(input.description, 'description', 200), v.num(input.amount, 'amount', { gt: true })]);
  return e.id;
}

async function voidExpense(q, expenseId) {
  const rows = await q(`UPDATE event_expenses SET deleted_at = now(), deleted_by = app_user_id() WHERE id = $1 AND deleted_at IS NULL RETURNING settlement_id`, [expenseId]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
  return rows[0].settlement_id;
}

/* Same-day financial closure, atomically: lock the contract, then close the settlement.
 * The triggers refuse the change unless the balance is zero and the event day has been reached,
 * and they close the contract and stamp settled_on_event_day in the same transaction. */
async function finalize(q, settlementId) {
  const [s] = await q('SELECT booking_id FROM event_settlements WHERE id = $1 AND deleted_at IS NULL', [settlementId]);
  if (!s) throw new ApiError(404, 'NOT_FOUND');
  await q('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [s.booking_id]);          // serialise with concurrent receipts
  const [done] = await q(`UPDATE event_settlements SET status = 'finalized' WHERE id = $1 RETURNING settled_on_event_day, net_profit, rental_share, marketing_share`, [settlementId]);
  return { bookingId: s.booking_id, settledOnEventDay: done.settled_on_event_day, netProfit: done.net_profit, rentalShare: done.rental_share, marketingShare: done.marketing_share };
}

async function reopen(q, settlementId) {
  const rows = await q(`UPDATE event_settlements SET status = 'draft' WHERE id = $1 AND deleted_at IS NULL RETURNING booking_id`, [settlementId]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
  return rows[0].booking_id;
}

/* Owner only (the trigger enforces it): per-settlement percentages and revenue override. */
async function ownerAdjust(q, settlementId, input) {
  const rental = v.num(input.rentalPct, 'rentalPct', { max: 100 }), marketing = v.num(input.marketingPct, 'marketingPct', { max: 100 });
  const override = input.revenueOverride === null || input.revenueOverride === '' || input.revenueOverride === undefined ? null : v.num(input.revenueOverride, 'revenueOverride');
  const rows = await q(`UPDATE event_settlements SET rental_pct = $2, marketing_pct = $3, revenue_override = $4, override_reason = $5 WHERE id = $1 AND deleted_at IS NULL RETURNING booking_id`,
    [settlementId, rental, marketing, override, override === null ? null : v.optStr(input.reason, 300)]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
  return rows[0].booking_id;
}

async function getSplit(q) {
  const [s] = await q('SELECT * FROM active_split()');
  return s && s.id ? { rental: s.rental_pct, marketing: s.marketing_pct, effectiveFrom: s.effective_from, note: s.note } : null;
}
async function setSplit(q, input) {
  const rental = v.num(input.rental, 'rental', { max: 100 }), marketing = v.num(input.marketing, 'marketing', { max: 100 });
  await q('INSERT INTO profit_split_settings (rental_pct, marketing_pct, note) VALUES ($1,$2,$3)', [rental, marketing, v.optStr(input.note, 200)]);
}

module.exports = { getForBooking, open, addExpense, voidExpense, finalize, reopen, ownerAdjust, getSplit, setSplit, CATEGORIES };
