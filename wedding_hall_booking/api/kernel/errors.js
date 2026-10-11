'use strict';
/* Translates PostgreSQL / trigger errors into stable API error codes (the UI localises them). */
class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
const RULES = [
  [/not available in this branch|another branch/i, 403, 'BRANCH_VIOLATION'],
  [/contract not found|settlement not found/i, 404, 'NOT_FOUND'],
  [/no_double_booking/i, 409, 'DOUBLE_BOOKING'],
  [/uq_settlement_per_booking/i, 409, 'SETTLEMENT_EXISTS'],
  [/exceeds the balance due|never_overpaid/i, 400, 'OVERPAY'],
  [/past date/i, 400, 'PAST_DATE'],
  [/discount_le_base/i, 400, 'DISCOUNT'],
  [/split_sums_to_100/i, 400, 'SPLIT_SUM'],
  [/override_needs_reason|only the owner may override/i, 400, 'OVERRIDE_REASON'],
  [/only the owner/i, 403, 'OWNER_ONLY'],
  [/restricted to the owner/i, 403, 'OWNER_ONLY'],
  [/frozen|is closed|is cancelled|can no longer be changed/i, 403, 'FROZEN'],
  [/has passed/i, 403, 'EVENT_PASSED'],
  [/settlement opens on the event day|before its event day|before the event day/i, 400, 'TOO_EARLY'],
  [/balance due/i, 400, 'BALANCE_NOT_ZERO'],
  [/no profit-split percentages/i, 409, 'SPLIT_NOT_SET'],
  [/has receipts/i, 409, 'HAS_RECEIPTS'],
  [/row-level security/i, 403, 'FORBIDDEN'],
  [/only the owner may manage user accounts/i, 403, 'OWNER_ONLY'],
  [/app\.user_id|unknown or inactive user/i, 401, 'UNAUTHENTICATED'],
];
function fromDb(e) {
  if (e instanceof ApiError) return e;
  const text = `${e.message || ''} ${e.constraint || ''}`;
  for (const [re, status, code] of RULES) if (re.test(text)) return new ApiError(status, code, e.message);
  if (e.code === '42501') return new ApiError(403, 'FORBIDDEN', e.message);
  if (e.code === '23505') return new ApiError(409, 'DUPLICATE', e.message);
  if (e.code === '23514' || e.code === '22P02' || e.code === '22003' || e.code === '23502') return new ApiError(400, 'INVALID', e.message);
  if (e.code === 'P0001') return new ApiError(400, 'RULE', e.message);
  return null;   // unexpected: caller logs it and answers 500
}
module.exports = { ApiError, fromDb };
