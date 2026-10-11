'use strict';
/* Services & Add-ons bounded context. A service is attached to a contract at any time; the database binds it
 * to the contract_number and recalculates the contract totals inside the same transaction. */
const v = require('../../kernel/validate');
const { ApiError } = require('../../kernel/errors');

const catalog = (q) => q('SELECT id, name, default_price FROM services WHERE is_active ORDER BY id');

async function addToContract(q, bookingId, input) {
  const name = v.str(input.name, 'name', 120);
  const [row] = await q(`INSERT INTO booking_services (booking_id, name, quantity, unit_price, service_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, contract_number`,
    [bookingId, name, v.num(input.quantity ?? 1, 'quantity', { min: 0, gt: true, max: 100000 }), v.num(input.unitPrice, 'unitPrice'),
     input.serviceId == null ? null : v.id(input.serviceId, 'serviceId')]);
  const [totals] = await q('SELECT total_amount, paid_total, balance_due FROM v_contracts WHERE id = $1', [bookingId]);
  return { id: row.id, contractNumber: row.contract_number, totals };      // the instant recalculation, straight from the database
}

async function remove(q, serviceId) {
  const rows = await q(`UPDATE booking_services SET deleted_at = now(), deleted_by = app_user_id() WHERE id = $1 AND deleted_at IS NULL RETURNING booking_id`, [serviceId]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
  return rows[0].booking_id;
}

module.exports = { catalog, addToContract, remove };
