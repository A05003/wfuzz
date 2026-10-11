# نظام إدارة قاعات الأفراح — ERP متعدد الفروع

Multi-branch **Venue & Event Management ERP**: contracts, add-on services, receipts, post-event settlement with profit split,
strict branch isolation, and a permanent audit trail. Arabic-first (RTL) with an English switch.

```
db/            PostgreSQL schema (triggers, row-level security) + SQL tests
api/           Node.js API — bounded contexts: rbac · bookings · services · settlement · operations · security · venue
web/           Next.js + Tailwind dashboard (static export, served by the API)
server/, app/  the earlier SQLite prototype (inventory / purchasing screens) — kept, not part of this system
```

## Run it
Requires Node.js ≥ 22.5.
```bash
cd wedding_hall_booking
npm install && npm run build:web     # installs API deps, builds the dashboard into web/out
npm start                            # http://127.0.0.1:3000
```
The first start creates the database and prints the initial password **once**. Without `DATABASE_URL` it uses an embedded PostgreSQL
(PGlite, stored in `data/pgdata`) so it runs anywhere; set `DATABASE_URL=postgres://…` (PostgreSQL 15+) for production.

Seeded accounts (all use the printed password; `SEED_PASSWORD` overrides it, `SEED_DEMO=0` skips demo data):

| username | role | scope |
|---|---|---|
| `owner` | المالك — Super Admin | all branches (switchable) |
| `manager` / `manager.north` | مدير الفرع | their own branch only |
| `supervisor` | مشرف ميداني / استقبال | their own branch, restricted view |

More users: owner → *Settings → Users*, or `npm run user -- add-user --username sara --name "سارة" --role manager --branch MAIN --email sara@x.com`.

Production settings: `JWT_SECRET` (≥ 32 chars, required), `NODE_ENV=production` (cookies become `Secure`; serve over HTTPS), `TRUST_PROXY=1` behind a reverse proxy,
`NOTIFY_DRIVER=webhook` + `NOTIFY_WEBHOOK_URL` to deliver recovery codes. The connecting database role must be allowed to `SET ROLE qasr_app`.

## Security model (defence in depth)
1. **JWT bound to role and branch.** Login issues an HS256 JWT in an `HttpOnly; SameSite=Strict` cookie with claims
   `{sub, role, branch_id | "ALL", sid}`. The owner's token is global (`ALL`); every other role carries its own branch.
   Each request re-checks the token against the session row and the user row, so a revoked session, a deactivated user, or a changed
   role/branch invalidates it immediately (`api/modules/rbac/jwt.js`, `service.js → authenticate`).
2. **Inspection middleware** (`api/app.js → handleApi`) runs before any SQL: authenticate → role permission → *branch boundary*
   (a branch user naming another branch in the query/body is refused) → bind. Every denial lands in `security_events`.
3. **Row-level security.** The API runs each request as `SET LOCAL ROLE qasr_app` with `app.user_id` / `app.scope_branch` set
   (`api/kernel/db.js`). Policies in `db/schema_v2.sql` filter every business table by branch, so even a query that forgets its
   `WHERE branch_id = …` cannot return another branch's rows. The owner sees all branches, or one via the branch switcher.
   Supervisors additionally cannot read payments, priced services or any non-active/other-day contract.
4. **No hard delete.** `DELETE` is converted to a soft delete by trigger and the application role has no `DELETE`/`TRUNCATE`
   privilege. Every create / update / soft-delete of contracts, services, receipts, settlements and expenses is archived in `audit_logs`
   (`user_id, action_type, timestamp, original_data, new_data`, plus `branch_id` and a `severity`). `audit_logs` is append-only.
   Soft deletions, edits of financial records, and anything done to closed contracts are flagged **warning / critical** and highlighted
   on the Super Admin security page.
5. **Owner-exclusive.** Profit-split percentages and financial overrides (revenue override with a mandatory reason, reopening a closed
   settlement) are enforced in the API *and* by database triggers.
6. **Login journal.** `login_logs` records every attempt (user, time, IP, device, assigned branch, requested branch, failure reason);
   accounts lock after 5 failures; password recovery codes are hashed, single-use, expire in 15 minutes, and revoke all sessions.

## Business rules
* A service can be added to a contract at any time (until the event day passes); it binds to the `contract_number` and the totals
  (`total_amount`, `paid_total`, `balance_due`) recalculate in the same transaction. Receipts are bound to the contract number too.
* **Same-day settlement:** the settlement opens on the event day; the contract closes only when the balance is zero; `settled_on_event_day` is recorded.
* `Net profit = contract revenue − direct expenses`, split by the owner's rental / marketing percentages (copied into each settlement when it is opened).
* Double booking is impossible per hall and section (database exclusion constraint); another hall or branch is independent.

## Tests
```bash
npm test         # 18 API tests: auth/JWT, branch isolation, RBAC, settlement, audit (embedded PostgreSQL, no setup)
npm run test:db  # SQL tests against an empty PostgreSQL 15+ database (psql)
cd web && npm run typecheck && npm run check:i18n
```

## Notes
* Recovery codes need a delivery channel. Out of the box they are printed to the server log (development); configure the webhook driver to send real e-mail/SMS.
* Profit-split percentages are global; the demo seeds 60/40 — the owner must set the real values before the first settlement in a real installation.
* `db/schema_v2.sql` + `db/schema_v2_app.sql` are applied automatically on first start of an empty database; there is no migration tool yet.
