'use strict';
/* Administration from the server shell:
 *   node api/cli.js add-user --username sara --name "سارة" --role manager|supervisor --branch MAIN --email sara@x.com [--phone 0501234567] [--password ...]
 *   (the owner is global and takes no --branch)
 *   node api/cli.js set-contact --username owner --email me@venue.com --phone 0501234567
 *   node api/cli.js set-password --username owner [--password ...]
 */
const db = require('./kernel/db');
const { hashPassword, passwordOk, normPhone, normEmail, generatePassword } = require('./modules/rbac/crypto');

const args = Object.fromEntries(process.argv.slice(3).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
async function main() {
  const cmd = process.argv[2];
  await db.open();
  if (cmd === 'add-user') {
    if (!args.username || !args.name || !['owner', 'manager', 'supervisor'].includes(args.role) || !(args.email || args.phone)) throw new Error('need --username --name --role owner|manager|supervisor and --email or --phone');
    let branchId = null;
    if (args.role !== 'owner') {
      const [b] = await db.system('SELECT id FROM branches WHERE upper(code) = upper($1) AND deleted_at IS NULL', [args.branch || '']);
      if (!b) throw new Error('unknown --branch code');
      branchId = b.id;
    }
    const pw = args.password || generatePassword(); if (!passwordOk(pw)) throw new Error('password needs 8+ characters with a letter and a digit');
    await db.system('INSERT INTO users (username, full_name, role, branch_id, password_hash, email, phone, phone_norm) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [args.username, args.name, args.role, branchId, await hashPassword(pw), args.email ? normEmail(args.email) : null, args.phone || null, args.phone ? normPhone(args.phone) : null]);
    console.log(`created ${args.username} (${args.role})${args.password ? '' : ` — initial password: ${pw}`}`);
  } else if (cmd === 'set-contact') {
    const r = await db.system('UPDATE users SET email = COALESCE($2, email), phone = COALESCE($3, phone), phone_norm = COALESCE($4, phone_norm) WHERE lower(username) = lower($1) RETURNING id',
      [args.username, args.email ? normEmail(args.email) : null, args.phone || null, args.phone ? normPhone(args.phone) : null]);
    if (!r.length) throw new Error('no such user'); console.log('contact updated');
  } else if (cmd === 'set-password') {
    const pw = args.password || generatePassword(); if (!passwordOk(pw)) throw new Error('password needs 8+ characters with a letter and a digit');
    const r = await db.system('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE lower(username) = lower($1) RETURNING id', [args.username, await hashPassword(pw)]);
    if (!r.length) throw new Error('no such user'); await db.system('DELETE FROM sessions WHERE user_id = $1', [r[0].id]);
    console.log(`password updated${args.password ? '' : ` — new password: ${pw}`}`);
  } else throw new Error('commands: add-user | set-contact | set-password');
  await db.close();
}
main().catch((e) => { console.error('error:', e.message); process.exit(1); });
