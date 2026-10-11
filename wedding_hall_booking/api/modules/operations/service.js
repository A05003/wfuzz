'use strict';
/* Event-Day Operations bounded context — what a field supervisor / receptionist works with:
   today's ACTIVE events (no contract money), the daily catering/screens checklist, and direct expense inputs.
   The projection below is deliberately narrow; row-level security also hides money tables from supervisors. */
const v = require('../../kernel/validate');
const { ApiError } = require('../../kernel/errors');
const settlement = require('../settlement/service');

const CATEGORIES = ['catering', 'screens', 'sound', 'seating', 'cleaning', 'other'];
const TEMPLATE = CATEGORIES.slice(0, 5).map((c) => [c, `chk.${c}`]);     // titles are i18n keys; custom items are free text

async function todayEvents(q) {
  const events = await q(`SELECT b.id, b.contract_number, b.branch_id, b.hall_id, h.name_ar AS hall_name_ar, h.name_en AS hall_name_en, b.section, b.client_name, b.status, b.event_date
                          FROM bookings b JOIN halls h ON h.id = b.hall_id
                          WHERE b.event_date = venue_today() AND b.deleted_at IS NULL AND b.status = 'confirmed' ORDER BY b.hall_id, b.id`);
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const checklist = await q(`SELECT id, booking_id, category, title, is_done, note, done_at FROM event_checklist_items WHERE booking_id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id`, [ids]);
  const settlements = await q(`SELECT id, booking_id, status FROM event_settlements WHERE booking_id = ANY($1::bigint[]) AND deleted_at IS NULL`, [ids]);
  const expenses = await q(`SELECT id, booking_id, category, description, amount FROM event_expenses WHERE booking_id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id`, [ids]);
  return events.map((e) => ({
    ...e,
    checklist: checklist.filter((c) => c.booking_id === e.id),
    settlement: settlements.find((s) => s.booking_id === e.id) || null,
    expenses: expenses.filter((x) => x.booking_id === e.id),
  }));
}

async function ensureVisible(q, bookingId) {
  const [b] = await q(`SELECT id FROM bookings WHERE id = $1 AND deleted_at IS NULL AND status = 'confirmed'`, [bookingId]);
  if (!b) throw new ApiError(404, 'NOT_FOUND');
}

/* idempotent: creates the standard daily checklist once */
async function initChecklist(q, bookingId) {
  await ensureVisible(q, bookingId);
  const [{ n }] = await q('SELECT count(*)::int AS n FROM event_checklist_items WHERE booking_id = $1 AND deleted_at IS NULL', [bookingId]);
  if (n > 0) return { created: 0 };
  for (const [category, title] of TEMPLATE) await q('INSERT INTO event_checklist_items (booking_id, category, title) VALUES ($1,$2,$3)', [bookingId, category, title]);
  return { created: TEMPLATE.length };
}
async function addItem(q, bookingId, i) {
  await ensureVisible(q, bookingId);
  const [r] = await q('INSERT INTO event_checklist_items (booking_id, category, title) VALUES ($1,$2,$3) RETURNING id', [bookingId, v.oneOf(i.category || 'other', CATEGORIES, 'category'), v.str(i.title, 'title', 120)]);
  return r.id;
}
async function setItem(q, itemId, i) {
  const rows = await q('UPDATE event_checklist_items SET is_done = $2, note = $3 WHERE id = $1 AND deleted_at IS NULL RETURNING id', [itemId, !!i.isDone, v.optStr(i.note, 200)]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
}

/* Direct expense input from the floor: opens the day's draft settlement if it does not exist yet, then records the expense. */
async function addExpense(q, bookingId, i) {
  await ensureVisible(q, bookingId);
  let [s] = await q('SELECT id FROM event_settlements WHERE booking_id = $1 AND deleted_at IS NULL', [bookingId]);
  const settlementId = s ? s.id : await settlement.open(q, bookingId);
  return { id: await settlement.addExpense(q, settlementId, i), settlementId };
}

module.exports = { todayEvents, initChecklist, addItem, setItem, addExpense };
