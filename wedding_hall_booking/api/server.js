'use strict';
/* Process entry point: open the database (first run: schema + seed), then listen. */
const db = require('./kernel/db');
const { seed } = require('./seed');
const { createServer } = require('./app');

async function main() {
  const info = await db.open();
  console.log(`database: ${info.kind}${info.fresh ? ' (initialised)' : ''}`);
  if (info.fresh) {
    const r = await seed();
    console.log('accounts created: owner (المالك) and manager (مدير القصر)');
    console.log(`initial password for both (shown once — change it): ${r.password}`);
    if (!r.demo) console.log('demo data disabled; set the profit split from the owner dashboard before the first settlement');
  }
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`listening on http://${host}:${port}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
