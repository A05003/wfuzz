'use strict';
/* Minimal HS256 JSON Web Token (RFC 7519) — no dependency.
 * Claims bind the caller to a scope:   { iss, sub: user id, role, branch_id: <id> | "ALL", sid, iat, exp }
 *   - branch_id is "ALL" only for the owner (global scope); every other role carries its own branch.
 *   - sid identifies the server-side session row, so a token can be revoked and a role/branch change forces re-login.
 */
const crypto = require('node:crypto');

let secret = null;
function key() {
  if (secret) return secret;
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return (secret = process.env.JWT_SECRET);
  }
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  console.warn('[auth] JWT_SECRET is not set: using a random secret for this process (sessions end on restart)');
  return (secret = crypto.randomBytes(48).toString('base64url'));
}
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', key()).update(data).digest('base64url');
const ISS = 'qasr-erp';

function sign(claims, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: ISS, ...claims, iat: now, exp: now + ttlSeconds })}`;
  return `${body}.${mac(body)}`;
}

/* returns the claims, or null for anything wrong (bad shape, algorithm, signature, issuer, expiry) */
function verify(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;           // never trust the header to pick the algorithm ("none" attack)
    const good = Buffer.from(mac(`${parts[0]}.${parts[1]}`)), got = Buffer.from(parts[2]);
    if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (claims.iss !== ISS || typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}
module.exports = { sign, verify };
