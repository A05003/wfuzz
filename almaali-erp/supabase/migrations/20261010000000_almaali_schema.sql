-- Al-Maali Catering ERP — core schema, auth profiles, automation, RLS.
-- Target: Supabase / PostgreSQL 15+. Run via `supabase db push` or psql.

create extension if not exists pgcrypto;

-- ───────────────────────── Enums ─────────────────────────
create type user_role       as enum ('admin','sales','kitchen','driver','pending');
create type customer_type   as enum ('wedding_hall','corporate','individual');
create type payment_method  as enum ('deferred_credit','cash','bank_transfer');
create type event_shift     as enum ('morning','evening');
create type booking_status  as enum ('pending','confirmed','cooking','out_for_delivery','delivered','completed','cancelled');
create type asset_status    as enum ('out','partially_returned','fully_returned','lost_discrepancy');
create type ledger_kind     as enum ('invoice','payment','asset_charge','adjustment');
create type invoice_status  as enum ('issued','partially_paid','paid','void');

-- ───────────────────────── Tables ─────────────────────────
-- Staff profile, one row per auth user. Role is assigned by an admin.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  role       user_role not null default 'pending',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers_halls (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  type              customer_type not null,
  payment_method    payment_method not null default 'cash',
  credit_limit      numeric(14,2) not null default 0 check (credit_limit >= 0),
  current_balance   numeric(14,2) not null default 0,   -- maintained by customer_ledger trigger
  assigned_staff_id uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table recipes_bom (
  id                 uuid primary key default gen_random_uuid(),
  dish_name          text not null unique,
  base_serving_size  integer not null check (base_serving_size > 0),
  price_per_serving  numeric(12,2) not null default 0 check (price_per_serving >= 0),
  -- {"rice_kg": 0.25, "meat_kg": 0.35}: amount per base_serving_size guests
  ingredients_json   jsonb not null default '{}'::jsonb check (jsonb_typeof(ingredients_json) = 'object'),
  created_at         timestamptz not null default now()
);

create table inventory_items (
  code          text primary key,                 -- matches keys in ingredients_json
  name          text not null,
  unit          text not null,
  stock         numeric(14,3) not null default 0 check (stock >= 0),
  reserved      numeric(14,3) not null default 0 check (reserved >= 0),
  safety_level  numeric(14,3) not null default 0 check (safety_level >= 0),
  updated_at    timestamptz not null default now()
);

create table bookings (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references customers_halls(id),
  event_date        date not null,
  event_time        event_shift not null default 'evening',
  guest_count       integer not null check (guest_count > 0),
  delivery_location text,
  status            booking_status not null default 'pending',
  subtotal          numeric(14,2) not null default 0,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,   -- subtotal + VAT
  created_by        uuid references profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on bookings (event_date, status);
create index on bookings (customer_id);

create table booking_dishes (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  recipe_id   uuid not null references recipes_bom(id),
  guest_count integer check (guest_count > 0),   -- null → use bookings.guest_count
  unit_price  numeric(12,2) check (unit_price >= 0),  -- null → recipe price
  unique (booking_id, recipe_id)
);

-- Result of the BOM explosion: raw material required per booking.
create table booking_materials (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete cascade,
  material_code text not null references inventory_items(code),
  quantity      numeric(14,3) not null check (quantity >= 0),
  consumed      boolean not null default false,
  unique (booking_id, material_code)
);

create table inventory_alerts (
  id            uuid primary key default gen_random_uuid(),
  material_code text not null references inventory_items(code),
  booking_id    uuid references bookings(id) on delete cascade,
  shortfall     numeric(14,3) not null,
  message       text not null,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table catering_assets (
  id               uuid primary key default gen_random_uuid(),
  asset_name       text not null unique,
  total_stock      integer not null check (total_stock >= 0),
  available_stock  integer not null check (available_stock >= 0),
  replacement_cost numeric(12,2) not null default 0 check (replacement_cost >= 0),
  check (available_stock <= total_stock)
);

create table asset_tracking (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references bookings(id) on delete cascade,
  asset_id            uuid not null references catering_assets(id),
  quantity_sent       integer not null check (quantity_sent > 0),
  quantity_returned   integer not null default 0 check (quantity_returned >= 0),
  inbound_confirmed   boolean not null default false,
  status              asset_status not null default 'out',
  discrepancy_charge  numeric(12,2) not null default 0,
  charge_booked       boolean not null default false,
  unique (booking_id, asset_id),
  check (quantity_returned <= quantity_sent)
);

create sequence invoice_seq;
create table invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text not null unique default ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 6, '0')),
  booking_id    uuid not null unique references bookings(id),
  customer_id   uuid not null references customers_halls(id),
  subtotal      numeric(14,2) not null,
  vat_amount    numeric(14,2) not null,
  total_amount  numeric(14,2) not null,
  paid_amount   numeric(14,2) not null default 0,
  status        invoice_status not null default 'issued',
  zatca_status  text not null default 'not_submitted',
  issued_at     timestamptz not null default now()
);

create table payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id),
  amount      numeric(14,2) not null check (amount > 0),
  method      payment_method not null,
  reference   text,
  received_by uuid references profiles(id) default auth.uid(),
  paid_at     timestamptz not null default now()
);

-- Every balance movement. Positive = customer owes more.
create table customer_ledger (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers_halls(id),
  booking_id  uuid references bookings(id),
  invoice_id  uuid references invoices(id),
  kind        ledger_kind not null,
  amount      numeric(14,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index on customer_ledger (customer_id, created_at);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function current_app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid() and is_active), 'pending'::user_role)
$$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger trg_touch before update on customers_halls for each row execute function touch_updated_at();
create trigger trg_touch before update on bookings       for each row execute function touch_updated_at();
create trigger trg_touch before update on inventory_items for each row execute function touch_updated_at();

-- ───────────────────────── Auth: profile on signup ─────────────────────────
-- Role comes from raw_app_meta_data (server-controlled), never from user-editable
-- metadata. Self-registered users stay 'pending' until an admin promotes them.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r user_role;
begin
  begin r := (new.raw_app_meta_data->>'role')::user_role; exception when others then r := 'pending'; end;
  insert into profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), coalesce(r,'pending'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ───────────────────────── Ledger → customer balance ─────────────────────────
create or replace function apply_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update customers_halls set current_balance = current_balance + new.amount where id = new.customer_id;
  return new;
end $$;
create trigger trg_apply_ledger after insert on customer_ledger for each row execute function apply_ledger();

-- ───────────────────────── Booking totals (15% VAT) ─────────────────────────
create or replace function recompute_booking_totals(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sub numeric(14,2); vat numeric(14,2);
begin
  select coalesce(sum(coalesce(d.guest_count,b.guest_count) * coalesce(d.unit_price,r.price_per_serving)),0)
    into sub
    from booking_dishes d join bookings b on b.id = d.booking_id join recipes_bom r on r.id = d.recipe_id
   where d.booking_id = p_booking;
  vat := round(sub * 0.15, 2);
  update bookings set subtotal = sub, vat_amount = vat, total_amount = sub + vat where id = p_booking;
end $$;

create or replace function trg_dishes_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare bid uuid := coalesce(new.booking_id, old.booking_id); st booking_status;
begin
  select status into st from bookings where id = bid;
  if st is not null and st <> 'pending' then
    raise exception 'Dishes can only be changed while the booking is pending (status: %)', st;
  end if;
  if st is not null then perform recompute_booking_totals(bid); end if;
  return coalesce(new, old);
end $$;
create trigger trg_dishes_changed after insert or update or delete on booking_dishes
  for each row execute function trg_dishes_changed();

create or replace function trg_booking_guests_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.guest_count is distinct from old.guest_count then
    if old.status <> 'pending' then raise exception 'guest_count can only change while pending'; end if;
    perform recompute_booking_totals(new.id);
  end if;
  return new;
end $$;
create trigger trg_booking_guests after update of guest_count on bookings
  for each row execute function trg_booking_guests_changed();

-- ───────────────────────── Recipe explosion & stock reservation ─────────────────────────
-- required = guests / base_serving_size × ingredient amount, summed over dishes.
create or replace function explode_booking(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m record; avail numeric; unknown text;
begin
  -- idempotent: release anything previously reserved for this booking
  update inventory_items i set reserved = i.reserved - bm.quantity
    from booking_materials bm where bm.booking_id = p_booking and bm.material_code = i.code and not bm.consumed;
  delete from booking_materials where booking_id = p_booking and not consumed;
  delete from inventory_alerts where booking_id = p_booking and not resolved;

  select k.key into unknown
    from booking_dishes d join recipes_bom r on r.id = d.recipe_id,
         jsonb_each(r.ingredients_json) k
   where d.booking_id = p_booking and not exists (select 1 from inventory_items i where i.code = k.key) limit 1;
  if unknown is not null then raise exception 'Recipe uses unknown inventory item "%"', unknown; end if;

  insert into booking_materials (booking_id, material_code, quantity)
  select p_booking, k.key,
         round(sum(coalesce(d.guest_count,b.guest_count)::numeric / r.base_serving_size * (k.value)::numeric), 3)
    from booking_dishes d
    join bookings b on b.id = d.booking_id
    join recipes_bom r on r.id = d.recipe_id,
         jsonb_each_text(r.ingredients_json) k(key, value)
   where d.booking_id = p_booking
   group by k.key;

  for m in select bm.material_code, bm.quantity from booking_materials bm where bm.booking_id = p_booking and not bm.consumed loop
    update inventory_items set reserved = reserved + m.quantity where code = m.material_code
      returning stock - reserved into avail;
    -- alert when free stock (after this reservation) drops below the safety level
    insert into inventory_alerts (material_code, booking_id, shortfall, message)
    select i.code, p_booking, i.safety_level - avail,
           format('%s: free stock %s %s is below safety level %s — order before the event', i.name, avail, i.unit, i.safety_level)
      from inventory_items i where i.code = m.material_code and avail < i.safety_level;
  end loop;
end $$;

-- Release reservations (booking cancelled before cooking).
create or replace function release_booking_materials(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update inventory_items i set reserved = i.reserved - bm.quantity
    from booking_materials bm where bm.booking_id = p_booking and bm.material_code = i.code and not bm.consumed;
  delete from booking_materials where booking_id = p_booking and not consumed;
  update inventory_alerts set resolved = true where booking_id = p_booking and not resolved;
end $$;

-- Cooking starts: reserved stock becomes consumed stock.
create or replace function consume_booking_materials(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update inventory_items i set stock = i.stock - bm.quantity, reserved = i.reserved - bm.quantity
    from booking_materials bm where bm.booking_id = p_booking and bm.material_code = i.code and not bm.consumed;
  update booking_materials set consumed = true where booking_id = p_booking;
end $$;

-- ───────────────────────── Invoicing ─────────────────────────
create or replace function issue_invoice(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b bookings; inv uuid;
begin
  select * into b from bookings where id = p_booking;
  insert into invoices (booking_id, customer_id, subtotal, vat_amount, total_amount)
  values (b.id, b.customer_id, b.subtotal, b.vat_amount, b.total_amount)
  on conflict (booking_id) do nothing returning id into inv;
  if inv is not null then
    insert into customer_ledger (customer_id, booking_id, invoice_id, kind, amount, note)
    values (b.customer_id, b.id, inv, 'invoice', b.total_amount, 'Invoice issued on booking confirmation');
  end if;
end $$;

create or replace function void_invoice(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  select * into inv from invoices where booking_id = p_booking and status <> 'void';
  if found then
    if inv.paid_amount > 0 then raise exception 'Invoice % already has payments; refund them before cancelling', inv.invoice_no; end if;
    update invoices set status = 'void' where id = inv.id;
    insert into customer_ledger (customer_id, booking_id, invoice_id, kind, amount, note)
    values (inv.customer_id, p_booking, inv.id, 'adjustment', -inv.total_amount, 'Invoice voided: booking cancelled');
  end if;
end $$;

create or replace function trg_payment_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  select * into inv from invoices where id = new.invoice_id for update;
  if inv.status = 'void' then raise exception 'Cannot pay a void invoice'; end if;
  if inv.paid_amount + new.amount > inv.total_amount then raise exception 'Payment exceeds invoice balance'; end if;
  update invoices set paid_amount = paid_amount + new.amount,
         status = case when paid_amount + new.amount >= total_amount then 'paid'::invoice_status else 'partially_paid'::invoice_status end
   where id = inv.id;
  insert into customer_ledger (customer_id, booking_id, invoice_id, kind, amount, note)
  values (inv.customer_id, inv.booking_id, inv.id, 'payment', -new.amount, coalesce(new.reference, new.method::text));
  return new;
end $$;
create trigger trg_payment_inserted after insert on payments for each row execute function trg_payment_inserted();

-- ───────────────────────── Booking lifecycle ─────────────────────────
-- Status can only change through set_booking_status(); the guard trigger enforces it.
create or replace function trg_booking_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('app.via_rpc', true),'') <> '1' then
    raise exception 'Use set_booking_status() to change booking status';
  end if;
  return new;
end $$;
create trigger trg_status_guard before update of status on bookings
  for each row execute function trg_booking_status_guard();

create or replace function trg_booking_status_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare c customers_halls;
begin
  if new.status = 'confirmed' and old.status = 'pending' then
    if new.total_amount <= 0 then raise exception 'Add at least one priced dish before confirming'; end if;
    select * into c from customers_halls where id = new.customer_id for update;
    if c.payment_method = 'deferred_credit' and c.current_balance + new.total_amount > c.credit_limit then
      raise exception 'Credit limit exceeded for %: balance % + % > limit %', c.name, c.current_balance, new.total_amount, c.credit_limit;
    end if;
    perform explode_booking(new.id);
    perform issue_invoice(new.id);
  elsif new.status = 'cooking' then
    perform consume_booking_materials(new.id);
  elsif new.status = 'cancelled' then
    perform release_booking_materials(new.id);
    perform void_invoice(new.id);
  end if;
  return new;
end $$;
create trigger trg_status_changed after update of status on bookings
  for each row when (new.status is distinct from old.status) execute function trg_booking_status_changed();

create or replace function set_booking_status(p_booking uuid, p_status booking_status) returns bookings
language plpgsql security definer set search_path = public as $$
declare b bookings; r user_role := current_app_role(); ok boolean;
begin
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'Booking not found'; end if;

  ok := case r
    when 'admin'   then (b.status, p_status) in (('pending','confirmed'),('pending','cancelled'),('confirmed','cancelled'),('confirmed','cooking'),
                         ('cooking','out_for_delivery'),('out_for_delivery','delivered'),('delivered','completed'))
    when 'sales'   then (b.status, p_status) in (('pending','confirmed'),('pending','cancelled'),('confirmed','cancelled'))
    when 'kitchen' then (b.status, p_status) in (('confirmed','cooking'))
    when 'driver'  then (b.status, p_status) in (('cooking','out_for_delivery'),('out_for_delivery','delivered'),('delivered','completed'))
    else false end;
  if not ok then raise exception 'Role % may not move booking from % to %', r, b.status, p_status; end if;

  -- closed-loop asset checklist
  if p_status = 'out_for_delivery' and not exists (select 1 from asset_tracking where booking_id = p_booking) then
    raise exception 'Outbound asset checklist is required before dispatch';
  end if;
  if p_status = 'completed' and exists (select 1 from asset_tracking where booking_id = p_booking and not inbound_confirmed) then
    raise exception 'Inbound asset verification is required before completion';
  end if;

  perform set_config('app.via_rpc','1', true);
  update bookings set status = p_status where id = p_booking returning * into b;
  perform set_config('app.via_rpc','', true);
  return b;
end $$;

-- ───────────────────────── Closed-loop assets ─────────────────────────
create or replace function trg_asset_tracking() returns trigger
language plpgsql security definer set search_path = public as $$
declare a catering_assets; missing int;
begin
  if tg_op = 'INSERT' then
    update catering_assets set available_stock = available_stock - new.quantity_sent where id = new.asset_id;
    new.status := 'out';
    return new;
  end if;

  if new.quantity_sent <> old.quantity_sent or new.asset_id <> old.asset_id or new.booking_id <> old.booking_id then
    raise exception 'Outbound record is immutable; delete and recreate it instead';
  end if;
  if old.inbound_confirmed then raise exception 'Inbound verification already confirmed'; end if;

  -- returned items go back on the shelf immediately
  update catering_assets set available_stock = available_stock + (new.quantity_returned - old.quantity_returned) where id = new.asset_id;

  if new.inbound_confirmed then
    missing := new.quantity_sent - new.quantity_returned;
    if missing = 0 then
      new.status := 'fully_returned';
    else
      new.status := 'lost_discrepancy';
      select * into a from catering_assets where id = new.asset_id;
      new.discrepancy_charge := missing * a.replacement_cost;
      -- the lost units leave the fleet permanently
      update catering_assets set total_stock = total_stock - missing where id = new.asset_id;
      if new.discrepancy_charge > 0 then
        insert into customer_ledger (customer_id, booking_id, kind, amount, note)
        select b.customer_id, b.id, 'asset_charge', new.discrepancy_charge,
               format('%s × %s missing (%s each)', missing, a.asset_name, a.replacement_cost)
          from bookings b where b.id = new.booking_id;
        new.charge_booked := true;
      end if;
    end if;
  elsif new.quantity_returned > 0 then
    new.status := 'partially_returned';
  end if;
  return new;
end $$;
create trigger trg_asset_tracking before insert or update on asset_tracking
  for each row execute function trg_asset_tracking();

-- ───────────────────────── Row Level Security ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['profiles','customers_halls','bookings','booking_dishes','booking_materials','recipes_bom',
    'inventory_items','inventory_alerts','catering_assets','asset_tracking','invoices','payments','customer_ledger']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

create policy profiles_self   on profiles for select to authenticated using (id = auth.uid() or current_app_role() = 'admin');
create policy profiles_admin  on profiles for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

create policy customers_rw  on customers_halls for all to authenticated
  using (current_app_role() in ('admin','sales')) with check (current_app_role() in ('admin','sales'));

create policy bookings_read   on bookings for select to authenticated using (current_app_role() in ('admin','sales','kitchen','driver'));
create policy bookings_insert on bookings for insert to authenticated with check (current_app_role() in ('admin','sales'));
create policy bookings_update on bookings for update to authenticated using (current_app_role() in ('admin','sales')) with check (current_app_role() in ('admin','sales'));
create policy bookings_delete on bookings for delete to authenticated using (current_app_role() = 'admin' and status in ('pending','cancelled'));

create policy dishes_read  on booking_dishes for select to authenticated using (current_app_role() in ('admin','sales','kitchen','driver'));
create policy dishes_write on booking_dishes for all    to authenticated
  using (current_app_role() in ('admin','sales')) with check (current_app_role() in ('admin','sales'));

create policy materials_read on booking_materials for select to authenticated using (current_app_role() in ('admin','sales','kitchen'));

create policy recipes_read  on recipes_bom for select to authenticated using (current_app_role() in ('admin','sales','kitchen'));
create policy recipes_write on recipes_bom for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

create policy inventory_read  on inventory_items for select to authenticated using (current_app_role() in ('admin','sales','kitchen'));
create policy inventory_write on inventory_items for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

create policy alerts_read  on inventory_alerts for select to authenticated using (current_app_role() in ('admin','kitchen'));
create policy alerts_write on inventory_alerts for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

create policy assets_read  on catering_assets for select to authenticated using (current_app_role() in ('admin','sales','kitchen','driver'));
create policy assets_write on catering_assets for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

create policy tracking_read   on asset_tracking for select to authenticated using (current_app_role() in ('admin','sales','driver'));
create policy tracking_insert on asset_tracking for insert to authenticated with check (current_app_role() in ('admin','sales','driver'));
create policy tracking_update on asset_tracking for update to authenticated using (current_app_role() in ('admin','driver')) with check (current_app_role() in ('admin','driver'));

create policy invoices_read   on invoices for select to authenticated using (current_app_role() in ('admin','sales'));
create policy payments_read   on payments for select to authenticated using (current_app_role() in ('admin','sales'));
create policy payments_insert on payments for insert to authenticated with check (current_app_role() in ('admin','sales'));
create policy ledger_read     on customer_ledger for select to authenticated using (current_app_role() in ('admin','sales'));

-- ───────────────────────── Grants ─────────────────────────
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- written only by SECURITY DEFINER triggers
revoke insert, update, delete on invoices, customer_ledger, booking_materials from authenticated;
revoke insert, delete on inventory_alerts from authenticated;
-- system-managed columns: restrict UPDATE to an explicit column list
revoke update on customers_halls, bookings, payments from authenticated;
grant update (name, type, payment_method, credit_limit, assigned_staff_id) on customers_halls to authenticated;
grant update (customer_id, event_date, event_time, guest_count, delivery_location) on bookings to authenticated;
-- payments are immutable once recorded
revoke delete on payments from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function set_booking_status(uuid, booking_status), current_app_role() to authenticated;
