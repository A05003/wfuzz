# Al-Maali Catering ERP — Database & Auth

PostgreSQL/Supabase schema implementing the PRD: tables, role-based Auth, and automation.

## Apply
```bash
supabase db push                       # or: psql "$DATABASE_URL" -f supabase/migrations/*_almaali_schema.sql
psql "$DATABASE_URL" -f supabase/seed.sql           # recipes, inventory, assets
psql "$DATABASE_URL" -f supabase/seed_dev_users.sql # DEV ONLY: the 4 demo users (password: "password")
```
In production create users in Supabase Auth with `app_metadata {"role": "admin|sales|kitchen|driver"}`.
Self-registered users get role `pending` (no access) until an admin changes `profiles.role`.

## What is automatic
| Event | Result |
|---|---|
| New `booking_dishes` row / guest count change | `subtotal`, 15% `vat_amount`, `total_amount` recomputed |
| `set_booking_status(id,'confirmed')` | credit-limit check (deferred accounts) → BOM explosion into `booking_materials` (guests ÷ base_serving × amount) → stock reserved → `inventory_alerts` if free stock < safety level → invoice issued → ledger debit updates `current_balance` |
| `'cooking'` | reserved stock is consumed from `inventory_items.stock` |
| `'cancelled'` | reservation released, invoice voided, ledger reversed |
| `payments` insert | invoice `paid_amount`/status and customer balance updated |
| `asset_tracking` insert/update | `available_stock` adjusted; on inbound confirmation a shortfall sets `lost_discrepancy`, charges `replacement_cost` to the ledger, and shrinks `total_stock` |
| `out_for_delivery` / `completed` | blocked without an outbound checklist / inbound verification |

Status changes **must** go through the RPC `set_booking_status(booking_id, status)` (role-checked transitions);
direct `UPDATE bookings SET status` is rejected. Money columns are system-managed and not client-writable.

## Test
`su postgres -c ./tests/run.sh` — builds a scratch DB with a stubbed `auth` schema and runs end-to-end assertions.

## Notes / assumptions
- Added beyond the PRD: `price_per_serving`, `inventory_items`, `invoices`, `payments`, `customer_ledger`, `replacement_cost`.
- ZATCA: `invoices.zatca_status` is a placeholder; XML/QR generation and submission are not implemented.
- Kitchen/driver roles can read `bookings` rows including totals (column-level hiding would need a view).
- No frontend is included yet.

## Web app (`web/`)
Next.js 14 + Supabase Auth (Arabic/RTL, light/dark by system). `/login` → routed by role to
`/admin`, `/sales`, `/kitchen`, `/driver`. All writes use the RPC/triggers above, so every booking,
invoice and ledger entry lands in the tables automatically. See `web/DEPLOY.md`.
Local: `cd web && cp .env.example .env.local && npm i && npm run dev`.
Not yet done: language toggle (Arabic only), recipe/inventory admin screens, live testing against a real Supabase project.
