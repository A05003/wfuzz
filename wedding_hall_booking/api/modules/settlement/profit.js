'use strict';
/* Post-Event Settlement — pure profit arithmetic (no I/O).
 * Works in integer cents so it matches PostgreSQL's NUMERIC arithmetic exactly:
 *   net      = revenue - expenses
 *   rental   = round(net * rental% / 100, 2)   (half away from zero, like PostgreSQL round())
 *   marketing= net - rental                    (so the two shares always add up to the net profit)
 */
const cents = (x) => Math.round(x * 100);

function computeSplit({ revenue, expenses, rentalPct }) {
  if (![revenue, expenses, rentalPct].every(Number.isFinite) || rentalPct < 0 || rentalPct > 100) throw new RangeError('invalid settlement inputs');
  const net = cents(revenue) - cents(expenses);
  const scaled = net * Math.round(rentalPct * 100);                    // cents * hundredths-of-a-percent
  const rental = Math.sign(scaled) * Math.floor((Math.abs(scaled) + 5000) / 10000);
  const marketing = net - rental;
  return { revenue, expenses, net: net / 100, rental: rental / 100, marketing: marketing / 100, rentalPct, marketingPct: Math.round((100 - rentalPct) * 100) / 100 };
}

/* The same-day closure rules, as the UI needs to show them (the database enforces them regardless). */
function describeClosure(contract, today) {
  const balanceZero = contract.balance_due === 0;
  const eventDayReached = contract.event_date <= today;
  const onEventDay = contract.event_date === today;
  return { balanceZero, eventDayReached, onEventDay, canFinalize: contract.status === 'confirmed' && balanceZero && eventDayReached };
}

module.exports = { computeSplit, describeClosure };
