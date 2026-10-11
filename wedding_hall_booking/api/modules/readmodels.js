'use strict';
/* Query side: read models that compose several bounded contexts for the UI (no business rules here). */
const { ApiError } = require('../kernel/errors');
const settlement = require('./settlement/service');
const { describeClosure, computeSplit } = require('./settlement/profit');

async function contractDetail(q, id) {
  const [contract] = await q('SELECT * FROM v_contracts WHERE id = $1', [id]);
  if (!contract) throw new ApiError(404, 'NOT_FOUND');
  const services = await q(`SELECT id, name, quantity, unit_price, line_total, added_at FROM booking_services WHERE booking_id = $1 AND deleted_at IS NULL ORDER BY id`, [id]);
  const payments = await q(`SELECT id, receipt_number, contract_number, amount, method, note, received_at FROM payments WHERE booking_id = $1 AND deleted_at IS NULL ORDER BY id`, [id]);
  const s = await settlement.getForBooking(q, id);
  const [{ today }] = await q('SELECT venue_today() AS today');
  return {
    today, contract, services, payments, settlement: s,
    closure: describeClosure(contract, today),
    // what the split would be right now (the database computes the stored values; this mirrors them for previews)
    preview: s ? computeSplit({ revenue: s.total_revenue, expenses: s.total_expenses, rentalPct: s.rental_pct }) : null,
  };
}

async function dashboard(q) {
  const [{ today }] = await q('SELECT venue_today() AS today');
  const todayIds = await q(`SELECT id FROM bookings WHERE event_date = venue_today() AND deleted_at IS NULL AND status <> 'cancelled' ORDER BY hall_id, id LIMIT 8`);
  const todays = [];
  for (const { id } of todayIds) todays.push(await contractDetail(q, id));
  const [next] = await q(`SELECT * FROM v_contracts WHERE event_date > venue_today() AND status = 'confirmed' ORDER BY event_date, id LIMIT 1`);
  const contracts = await q(`SELECT * FROM v_contracts WHERE status <> 'cancelled' ORDER BY event_date DESC, id DESC LIMIT 300`);
  const [k] = await q(`SELECT
      count(*) FILTER (WHERE event_date = venue_today() AND status <> 'cancelled')::int AS today_events,
      count(*) FILTER (WHERE settlement_due_today OR settlement_overdue)::int AS settlements_pending,
      COALESCE(sum(balance_due) FILTER (WHERE status = 'confirmed'), 0) AS outstanding,
      COALESCE(sum(net_profit) FILTER (WHERE settlement_status = 'finalized'), 0) AS net_profit
    FROM v_contracts WHERE status <> 'cancelled'`);
  return { today, todays, next: next || null, contracts, kpis: k, split: await settlement.getSplit(q) };
}

module.exports = { contractDetail, dashboard };
