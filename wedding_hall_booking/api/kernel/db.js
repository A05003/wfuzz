'use strict';
/* Database access. Two interchangeable backends behind one tiny interface:
 *   - DATABASE_URL set  -> a real PostgreSQL server through `pg` (production)
 *   - otherwise         -> embedded PostgreSQL (PGlite) persisted in ./data/pgdata (zero-install / demos / tests)
 *
 *   tx(actor, async (q) => {...})    ONE transaction on behalf of a user: actor = { id, role, scopeBranch }.
 *                                    It sets app.user_id / app.scope_branch and then `SET LOCAL ROLE qasr_app`, so the
 *                                    schema's row-level security (branch isolation) and grants really apply.
 *   system(sql, params)              privileged access WITHOUT row-level security. Only for pre-authentication work
 *   systemTx(async (q) => {...})     (login, sessions, recovery) and the security journals. Never use it for business data.
 *   q(sql, params) -> rows[]
 */
const fs = require('node:fs');
const path = require('node:path');

const DB_DIR = path.join(__dirname, '..', '..', 'db');
const NUMERIC = 1700, DATE = 1082;

let backend; // { tx, query, exec, close }

/* Attribute the transaction to a user, bind the branch scope, and drop to the unprivileged application role. */
async function bindActor(run, actor) {
  await run("SELECT set_config('app.user_id', $1, true), set_config('app.scope_branch', $2, true)",
    [String(actor.id), actor.scopeBranch == null ? 'ALL' : String(actor.scopeBranch)]);
  await run('SET LOCAL ROLE qasr_app');
}

async function open(opts = {}) {
  const url = opts.url !== undefined ? opts.url : process.env.DATABASE_URL;
  backend = url ? await openPg(url) : await openEmbedded(opts.dataDir !== undefined ? opts.dataDir : process.env.PGDATA_DIR || path.join(__dirname, '..', '..', 'data', 'pgdata'));
  const fresh = !(await backend.query("SELECT to_regclass('public.users') AS t"))[0].t;
  if (fresh) {
    await backend.exec(fs.readFileSync(path.join(DB_DIR, 'schema_v2.sql'), 'utf8'));
    await backend.exec(fs.readFileSync(path.join(DB_DIR, 'schema_v2_app.sql'), 'utf8'));
  }
  return { fresh, kind: url ? 'postgres' : 'embedded' };
}

async function openPg(url) {
  const pg = require('pg');
  pg.types.setTypeParser(NUMERIC, parseFloat);   // NUMERIC -> number (money fits comfortably in a double)
  pg.types.setTypeParser(DATE, (v) => v);        // DATE -> 'YYYY-MM-DD' string, no timezone games
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10) });
  return {
    exec: (sql) => pool.query(sql),
    query: async (sql, p) => (await pool.query(sql, p)).rows,
    async tx(actor, fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        if (actor) await bindActor((sql, p) => c.query(sql, p), actor);
        const out = await fn(async (sql, p) => (await c.query(sql, p)).rows);
        await c.query('COMMIT');
        return out;
      } catch (e) { try { await c.query('ROLLBACK'); } catch { /* connection already broken */ } throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
}

async function openEmbedded(dir) {
  const { PGlite } = require('@electric-sql/pglite');
  const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');
  const where = dir === ':memory:' ? 'memory://' : dir;
  if (dir !== ':memory:') fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(where, { extensions: { btree_gist }, parsers: { [NUMERIC]: parseFloat, [DATE]: (v) => v } });
  await db.waitReady;
  return {
    exec: (sql) => db.exec(sql),
    query: async (sql, p) => (await db.query(sql, p)).rows,
    tx: (actor, fn) => db.transaction(async (t) => {
      if (actor) await bindActor((sql, p) => t.query(sql, p), actor);
      return fn(async (sql, p) => (await t.query(sql, p)).rows);
    }),
    close: () => db.close(),
  };
}

module.exports = {
  open,
  tx: (actor, fn) => backend.tx(actor, fn),
  system: (sql, p) => backend.query(sql, p),
  systemTx: (fn) => backend.tx(null, fn),
  close: () => backend && backend.close(),
};
