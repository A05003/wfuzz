'use strict';
/* The venue this installation belongs to (login-page branding) and its halls. Owner-managed. */
const v = require('../../kernel/validate');
const { ApiError } = require('../../kernel/errors');

const publicInfo = (db) => db.system('SELECT name_ar, name_en, tagline_ar, tagline_en, logo_text FROM v_public_venue').then((r) => r[0] || null);
const get = (q) => q('SELECT name_ar, name_en, tagline_ar, tagline_en, logo_text, phone, email FROM venue_settings WHERE id = 1').then((r) => r[0]);

async function update(q, i) {
  await q(`UPDATE venue_settings SET name_ar=$1, name_en=$2, tagline_ar=$3, tagline_en=$4, logo_text=$5, phone=$6, email=$7 WHERE id = 1`,
    [v.str(i.name_ar, 'name_ar', 80), v.str(i.name_en, 'name_en', 80), v.optStr(i.tagline_ar, 120), v.optStr(i.tagline_en, 120),
     v.str(i.logo_text || '♛', 'logo_text', 4), v.optStr(i.phone, 30), v.optStr(i.email, 100)]);
}

const listBranches = (q) => q(`SELECT id, code, name_ar, name_en, city, phone, is_active FROM branches WHERE deleted_at IS NULL ORDER BY id`);
async function createBranch(q, i) {
  const [b] = await q(`INSERT INTO branches (code, name_ar, name_en, city, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [v.str(i.code, 'code', 12).toUpperCase(), v.str(i.name_ar, 'name_ar', 80), v.str(i.name_en, 'name_en', 80), v.optStr(i.city, 60), v.optStr(i.phone, 30)]);
  return b.id;
}
async function updateBranch(q, id, i) {
  const rows = await q(`UPDATE branches SET name_ar=$2, name_en=$3, city=$4, phone=$5, is_active=$6 WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
    [id, v.str(i.name_ar, 'name_ar', 80), v.str(i.name_en, 'name_en', 80), v.optStr(i.city, 60), v.optStr(i.phone, 30), i.is_active !== false]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
}

async function createHall(q, i) {
  const [h] = await q(`INSERT INTO halls (branch_id, name_ar, name_en, capacity_men, capacity_women, base_price) VALUES ($6,$1,$2,$3,$4,$5) RETURNING id`,
    [v.str(i.name_ar, 'name_ar', 80), v.str(i.name_en, 'name_en', 80), v.int(i.capacity_men ?? 0, 'capacity_men'), v.int(i.capacity_women ?? 0, 'capacity_women'), v.num(i.base_price ?? 0, 'base_price'), v.id(i.branchId, 'branchId')]);
  return h.id;
}
async function updateHall(q, id, i) {
  const rows = await q(`UPDATE halls SET name_ar=$2, name_en=$3, capacity_men=$4, capacity_women=$5, base_price=$6, is_active=$7 WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
    [id, v.str(i.name_ar, 'name_ar', 80), v.str(i.name_en, 'name_en', 80), v.int(i.capacity_men ?? 0, 'capacity_men'), v.int(i.capacity_women ?? 0, 'capacity_women'),
     v.num(i.base_price ?? 0, 'base_price'), i.is_active !== false]);
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND');
}
module.exports = { publicInfo, get, update, listBranches, createBranch, updateBranch, createHall, updateHall };
