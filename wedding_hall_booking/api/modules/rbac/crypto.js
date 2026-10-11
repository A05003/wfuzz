'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(hashHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
const DUMMY = hashPassword('dummy-password-for-timing');   // verified against when the user does not exist

/* at least 8 chars, a letter and a digit */
const passwordOk = (pw) => typeof pw === 'string' && pw.length >= 8 && pw.length <= 128 && /[A-Za-z؀-ۿ]/.test(pw) && /\d/.test(pw);

const normPhone = (p) => String(p || '').replace(/\D+/g, '');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const looksEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/* tiny fixed-window rate limiter (per process) */
const buckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now(); const b = buckets.get(key);
  if (!b || now > b.until) { buckets.set(key, { n: 1, until: now + windowMs }); return false; }
  b.n += 1; return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (now > v.until) buckets.delete(k); }, 60_000).unref();

function generatePassword() {
  for (;;) { const p = crypto.randomBytes(9).toString('base64url'); if (passwordOk(p)) return p; }
}

module.exports = { generatePassword, sha256, hashPassword, verifyPassword, DUMMY, passwordOk, normPhone, normEmail, looksEmail, rateLimited };
