'use strict';
/* RBAC bounded context — authentication (JWT bound to role + branch), sessions, login journal, password recovery. */
const crypto = require('node:crypto');
const db = require('../../kernel/db');
const { ApiError } = require('../../kernel/errors');
const c = require('./crypto');
const jwt = require('./jwt');
const notify = require('./notify');
const { deviceInfo } = require('./device');
const { permissionsOf } = require('./permissions');

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const MAX_FAILS = 5, LOCK_MIN = 15, CODE_MIN = 15, MAX_CODE_TRIES = 5;

/* ---------- journals (append-only; the API's system connection is the only writer) ---------- */
function logLogin(e) {
  return db.system(`INSERT INTO login_logs (user_id, username_attempted, event_type, success, failure_reason, ip_address, device_info, assigned_branch_id, requested_branch)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.userId ?? null, String(e.username || '').slice(0, 80), e.event || 'login', e.success, e.reason || null, e.ip || null, e.device || null, e.branchId ?? null, e.requested == null ? null : String(e.requested)])
    .catch((err) => console.error('[login_logs]', err.message));
}
/* PERMISSION_DENIED / BRANCH_VIOLATION / UNAUTHENTICATED_ACCESS ... shown on the Super Admin security page */
function logSecurityEvent(e) {
  return db.system(`INSERT INTO security_events (user_id, event_type, method, path, ip_address, branch_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.userId ?? null, e.type, e.method || null, String(e.path || '').slice(0, 200), e.ip || null, e.branchId ?? null, String(e.detail || '').slice(0, 300)])
    .catch((err) => console.error('[security_events]', err.message));
}

const publicUser = (u, scopeBranch, branches) => ({
  id: Number(u.id), username: u.username, name: u.full_name, role: u.role, lang: u.lang,
  email: u.email || null, phone: u.phone || null, perms: permissionsOf(u.role),
  branchId: u.branch_id == null ? null : Number(u.branch_id),              // null = global (owner)
  scopeBranch: scopeBranch == null ? null : Number(scopeBranch),            // what this session currently looks at (null = all branches)
  branch: u.branch_id == null ? null : (branches || []).find((b) => Number(b.id) === Number(u.branch_id)) || null,
});

const listBranches = () => db.system(`SELECT id, code, name_ar, name_en, city, phone, is_active FROM branches WHERE deleted_at IS NULL ORDER BY id`);

/* requested = what the login form's branch selector sent: undefined | 'ALL' | <branch id> */
async function login({ username, password, branch, userAgent, ip }) {
  const device = deviceInfo(userAgent), requested = branch === undefined || branch === null || branch === '' ? null : String(branch);
  const base = { username: typeof username === 'string' ? username.trim().slice(0, 80) : '', ip, device, requested };
  if (c.rateLimited('login:ip:' + ip, 30, 10 * 60_000)) { await logLogin({ ...base, success: false, reason: 'rate_limited' }); throw new ApiError(429, 'RATE_LIMITED'); }
  if (typeof username !== 'string' || typeof password !== 'string' || !base.username || password.length > 256) throw new ApiError(400, 'INVALID');

  const [u] = await db.system('SELECT * FROM users WHERE lower(username) = lower($1)', [base.username]);
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
    await logLogin({ ...base, userId: u.id, branchId: u.branch_id, success: false, reason: 'locked' }); throw new ApiError(429, 'LOCKED');
  }
  // always run a full hash verification so a missing user costs the same as a wrong password
  const ok = await c.verifyPassword(password, u ? u.password_hash : await c.DUMMY);
  if (!u || !ok) {
    if (u) await db.system(`UPDATE users SET failed_logins = failed_logins + 1,
        locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END WHERE id = $1`, [u.id, MAX_FAILS, LOCK_MIN]);
    await logLogin({ ...base, userId: u && u.id, branchId: u && u.branch_id, success: false, reason: 'bad_credentials' });
    throw new ApiError(401, 'BAD_CREDENTIALS');
  }
  if (!u.is_active) { await logLogin({ ...base, userId: u.id, branchId: u.branch_id, success: false, reason: 'inactive' }); throw new ApiError(401, 'BAD_CREDENTIALS'); }

  // ----- scope: a branch-bound user can only ever log in to their own branch; the owner may start anywhere -----
  let scope;
  if (u.role === 'owner') {
    if (requested === null || requested.toUpperCase() === 'ALL') scope = null;
    else {
      const [b] = await db.system('SELECT id FROM branches WHERE id = $1 AND is_active AND deleted_at IS NULL', [Number(requested) || 0]);
      if (!b) throw new ApiError(400, 'INVALID');
      scope = Number(b.id);
    }
  } else {
    // 'ALL' / nothing = "no explicit choice" (the form's default); an explicit OTHER branch is a boundary violation
    if (requested !== null && requested.toUpperCase() !== 'ALL' && Number(requested) !== Number(u.branch_id)) {
      await logLogin({ ...base, userId: u.id, branchId: u.branch_id, success: false, reason: 'branch_mismatch' });
      await logSecurityEvent({ userId: u.id, type: 'BRANCH_VIOLATION', method: 'POST', path: '/api/auth/login', ip, branchId: u.branch_id, detail: `login attempted for branch ${requested}` });
      throw new ApiError(403, 'BRANCH_MISMATCH');
    }
    scope = Number(u.branch_id);
  }

  await db.system('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  const sid = crypto.randomBytes(24).toString('base64url');
  const ttl = SESSION_HOURS * 3600;
  await db.system(`INSERT INTO sessions (token_hash, user_id, branch_id, ip_address, device_info, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6))`,
    [c.sha256(sid), u.id, scope, ip, device, ttl]);
  const token = jwt.sign({ sub: String(u.id), role: u.role, branch_id: u.branch_id == null ? 'ALL' : Number(u.branch_id), sid }, ttl);
  await logLogin({ ...base, userId: u.id, branchId: u.branch_id, success: true });
  return { token, maxAge: ttl, user: publicUser(u, scope, await listBranches()) };
}

/* The authentication half of the inspection middleware: verify the JWT, then re-check it against the database
   (session still alive, account still active, role and branch unchanged since the token was issued). */
async function authenticate(token) {
  const claims = jwt.verify(token);
  if (!claims || typeof claims.sid !== 'string') return null;
  const [r] = await db.system(`SELECT s.id AS session_id, s.branch_id AS scope_branch, s.last_seen_at, u.*
                               FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`, [c.sha256(claims.sid)]);
  if (!r) return null;
  const claimedBranch = u_branch(r.branch_id);
  if (String(r.id) !== claims.sub || r.role !== claims.role || claimedBranch !== String(claims.branch_id)) return null;   // privileges changed: sign in again
  if (Date.now() - new Date(r.last_seen_at).getTime() > 60_000) db.system('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [r.session_id]).catch(() => {});
  const scope = r.role === 'owner' ? (r.scope_branch == null ? null : Number(r.scope_branch)) : Number(r.branch_id);
  return { user: r, scopeBranch: scope, sessionId: Number(r.session_id) };
}
const u_branch = (b) => (b == null ? 'ALL' : String(b));

async function logout(token, ip, userAgent) {
  const claims = jwt.verify(token);
  if (!claims) return;
  const [s] = await db.system('DELETE FROM sessions WHERE token_hash = $1 RETURNING user_id', [c.sha256(claims.sid)]);
  if (s) await logLogin({ userId: s.user_id, event: 'logout', success: true, ip, device: deviceInfo(userAgent) });
}

/* the owner switches the branch they are looking at ("ALL" = consolidated view) */
async function setScope(sessionId, user, branch) {
  if (user.role !== 'owner') throw new ApiError(403, 'BRANCH_VIOLATION');
  let scope = null;
  if (branch !== 'ALL' && branch !== null && branch !== undefined) {
    const [b] = await db.system('SELECT id FROM branches WHERE id = $1 AND is_active AND deleted_at IS NULL', [Number(branch) || 0]);
    if (!b) throw new ApiError(400, 'INVALID');
    scope = Number(b.id);
  }
  await db.system('UPDATE sessions SET branch_id = $2 WHERE id = $1', [sessionId, scope]);
  return scope;
}

const setLang = (userId, lang) => db.system('UPDATE users SET lang = $2 WHERE id = $1', [userId, lang]);
const revokeSession = (id) => db.system('DELETE FROM sessions WHERE id = $1 RETURNING user_id', [id]);

/* ---------- password recovery (e-mail or phone) ---------- */
async function findByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (c.looksEmail(id)) return { channel: 'email', user: (await db.system('SELECT * FROM users WHERE lower(email) = $1 AND is_active', [c.normEmail(id)]))[0] };
  const digits = c.normPhone(id);
  if (digits.length < 9) return { channel: 'sms', user: null };
  // match on the last 9 digits so 0501112233 and +966501112233 are the same number; ambiguous => no match
  const rows = await db.system('SELECT * FROM users WHERE is_active AND right(phone_norm, 9) = $1 LIMIT 2', [digits.slice(-9)]);
  return { channel: 'sms', user: rows.length === 1 ? rows[0] : null };
}
const codeHash = (userId, code) => c.sha256(`${userId}:${code}`);

/* Always answers the same way, whether or not the account exists. */
async function requestRecovery({ identifier, ip, userAgent }) {
  const key = String(identifier || '').trim().toLowerCase();
  if (!key || key.length > 120) throw new ApiError(400, 'INVALID');
  if (c.rateLimited('forgot:ip:' + ip, 10, 3600_000) || c.rateLimited('forgot:id:' + key, 5, 3600_000)) throw new ApiError(429, 'RATE_LIMITED');
  const { channel, user } = await findByIdentifier(key);
  await logLogin({ userId: user && user.id, username: key, event: 'recovery_request', success: !!user, reason: user ? null : 'unknown_account', ip, device: deviceInfo(userAgent), branchId: user && user.branch_id });
  if (!user) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.systemTx(async (q) => {
    await q('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    await q(`INSERT INTO password_resets (user_id, code_hash, channel, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [user.id, codeHash(user.id, code), channel, CODE_MIN]);
  });
  const [venue] = await db.system('SELECT name_ar, name_en FROM v_public_venue');
  const to = channel === 'email' ? user.email : user.phone;
  // fire and forget: the HTTP answer must not reveal whether delivery was attempted
  notify.sendRecoveryCode({ channel, to, lang: user.lang, venue: venue ? (user.lang === 'ar' ? venue.name_ar : venue.name_en) : '', code })
    .catch((e) => console.error('[recovery] delivery failed:', e.message));
}

async function resetPassword({ identifier, code, password, ip, userAgent }) {
  const key = String(identifier || '').trim().toLowerCase();
  if (c.rateLimited('reset:ip:' + ip, 20, 3600_000) || c.rateLimited('reset:id:' + key, 10, 3600_000)) throw new ApiError(429, 'RATE_LIMITED');
  if (!c.passwordOk(password)) throw new ApiError(400, 'WEAK_PASSWORD');
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) throw new ApiError(400, 'INVALID_CODE');
  const { user } = await findByIdentifier(key);
  const invalid = new ApiError(400, 'INVALID_CODE');
  if (!user) throw invalid;
  const [r] = await db.system(`SELECT * FROM password_resets WHERE user_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`, [user.id]);
  if (!r || r.attempts >= MAX_CODE_TRIES) throw invalid;
  const want = Buffer.from(r.code_hash, 'hex'), got = Buffer.from(codeHash(user.id, code.trim()), 'hex');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    await db.system('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [r.id]);
    throw invalid;
  }
  const hash = await c.hashPassword(password);
  await db.systemTx(async (q) => {
    await q('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id, hash]);
    await q('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id]);
    await q('DELETE FROM sessions WHERE user_id = $1', [user.id]);          // every existing session is signed out
  });
  await logLogin({ userId: user.id, username: user.username, event: 'password_reset', success: true, ip, device: deviceInfo(userAgent), branchId: user.branch_id });
}

module.exports = { login, logout, authenticate, publicUser, setLang, setScope, revokeSession, requestRecovery, resetPassword, listBranches, logSecurityEvent, logLogin };
