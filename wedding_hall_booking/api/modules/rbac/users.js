'use strict';
/* RBAC bounded context — account administration (owner only; users_guard in the database enforces it too). */
const v = require('../../kernel/validate');
const { ApiError } = require('../../kernel/errors');
const c = require('./crypto');
const { generatePassword } = c;

const ROLES = ['owner', 'manager', 'supervisor'];

const list = (q) => q(`SELECT u.id, u.username, u.full_name, u.role, u.branch_id, br.name_ar AS branch_name_ar, br.name_en AS branch_name_en, u.is_active, u.email, u.phone, u.lang, u.created_at
                       FROM users u LEFT JOIN branches br ON br.id = u.branch_id ORDER BY u.id`);

function clean(i) {
  const role = v.oneOf(i.role, ROLES, 'role');
  const branchId = role === 'owner' ? null : v.id(i.branchId, 'branchId');
  const email = i.email ? c.normEmail(v.str(i.email, 'email', 120)) : null, phone = i.phone ? v.str(i.phone, 'phone', 30) : null;
  if (email && !c.looksEmail(email)) throw new ApiError(400, 'INVALID');
  if (!email && !phone) throw new ApiError(400, 'CONTACT_REQUIRED');       // needed for password recovery
  return { role, branchId, email, phone, phoneNorm: phone ? c.normPhone(phone) : null, fullName: v.str(i.fullName, 'fullName', 100) };
}

/* returns the initial password ONCE (the owner hands it over; the user is expected to change it through recovery) */
async function create(q, i) {
  const u = clean(i);
  const password = i.password ? String(i.password) : generatePassword();
  if (!c.passwordOk(password)) throw new ApiError(400, 'WEAK_PASSWORD');
  const [row] = await q(`INSERT INTO users (username, full_name, role, branch_id, password_hash, email, phone, phone_norm) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [v.str(i.username, 'username', 40).toLowerCase(), u.fullName, u.role, u.branchId, await c.hashPassword(password), u.email, u.phone, u.phoneNorm]);
  return { id: row.id, password };
}

async function update(q, id, i, actorId) {
  const u = clean(i);
  const isActive = i.isActive !== false;
  if (id === actorId && (!isActive || u.role !== 'owner')) throw new ApiError(409, 'SELF_LOCKOUT');   // the owner cannot demote or lock out themselves
  const rows = await q(`UPDATE users SET full_name=$2, role=$3, branch_id=$4, email=$5, phone=$6, phone_norm=$7, is_active=$8 WHERE id = $1 RETURNING id`,
    [id, u.fullName, u.role, u.branchId, u.email, u.phone, u.phoneNorm, isActive]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
}
module.exports = { list, create, update, ROLES };
