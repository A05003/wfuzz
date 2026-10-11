'use strict';
/* Security & inspection bounded context — the Super Admin's read models. Every function re-checks the owner role in
   the database (assert_owner), on top of the route permission. */
const v = require('../../kernel/validate');
const db = require('../../kernel/db');

async function overview(q) {
  const [k] = await q('SELECT * FROM owner_security_overview()');
  const n = (x) => Number(x);
  return { critical7d: n(k.critical_7d), warnings7d: n(k.warnings_7d), failedLogins24h: n(k.failed_logins_24h), logins24h: n(k.logins_24h), softDeleted: n(k.soft_deleted),
           activeSessions: n(k.active_sessions), securityEvents7d: n(k.security_events_7d), branchViolations7d: n(k.branch_violations_7d) };
}
const logins = (q, { limit, user, onlyFailed }) => q('SELECT * FROM owner_login_history($1, $2, $3)', [limit, user, onlyFailed]);
const events = (q, limit) => q('SELECT * FROM owner_security_events($1)', [limit]);
const deleted = (q, limit) => q('SELECT * FROM owner_deleted_items($1)', [limit]);
const branchFinancials = (q) => q('SELECT * FROM owner_branch_financials()');
const sessions = (q) => q('SELECT * FROM owner_active_sessions()');
const audit = (q, { contract, severity, branch, limit }) => q(
  `SELECT a.id, a.user_id, u.full_name AS user_name, a.action_type AS action, a."timestamp", a.table_name, a.record_id, a.branch_id, a.contract_number, a.severity,
          a.original_data AS old_value, a.new_data AS new_value
   FROM owner_audit_review($1, $2, $3, $4) a JOIN users u ON u.id = a.user_id ORDER BY a."timestamp" DESC, a.id DESC`, [contract, limit, severity, branch]);

module.exports = { overview, logins, events, deleted, branchFinancials, sessions, audit, lim: (x, d = 200) => Math.min(Math.max(Number(x) | 0 || d, 1), 500) };
