'use strict';
/* RBAC bounded context: the single source of truth for who may do what.
 * The database triggers and row-level security enforce the same rules a second time (defence in depth).
 *   owner       المالك — global scope (all branches), exclusive control of profit-split and financial overrides
 *   manager     مدير الفرع — bound to ONE branch
 *   supervisor  مشرف ميداني / استقبال — bound to ONE branch, restricted view (today's events, checklist, direct expenses)
 */
const OWNER = 'owner', MANAGER = 'manager', SUPERVISOR = 'supervisor';
const OM = [OWNER, MANAGER], ALL = [OWNER, MANAGER, SUPERVISOR];

const PERMISSIONS = {
  'booking.read': OM, 'booking.write': OM,
  'service.write': OM,                    // add-ons on a contract
  'payment.write': OM,                    // issue receipts
  'event.view.active': ALL,               // today's active events (no contract money for supervisors)
  'checklist.write': ALL,                 // daily catering / screens / sound checklist
  'expense.write': ALL,                   // direct event expenses
  'settlement.open': ALL,
  'settlement.finalize': OM,
  'settlement.reopen': [OWNER],
  'split.write': [OWNER],                 // profit-split percentages
  'override.write': [OWNER],              // override financial values
  'audit.read': [OWNER],                  // security dashboard, audit trail, login history
  'venue.write': [OWNER], 'hall.write': [OWNER], 'branch.write': [OWNER], 'user.write': [OWNER], 'session.revoke': [OWNER],
};
const can = (role, perm) => !!PERMISSIONS[perm] && PERMISSIONS[perm].includes(role);
const permissionsOf = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));

module.exports = { PERMISSIONS, can, permissionsOf, OWNER, MANAGER, SUPERVISOR };
