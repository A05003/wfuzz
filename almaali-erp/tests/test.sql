\set ON_ERROR_STOP on
create or replace function as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), false);
  execute 'set role authenticated';
end $$;
create or replace function expect_fail(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; raise exception 'EXPECTED FAILURE BUT SUCCEEDED: %', p_label;
  exception when others then
    if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
    raise notice 'ok (blocked): % -> %', p_label, sqlerrm;
  end;
end $$;
grant execute on function as_user(text), expect_fail(text,text) to public;

-- users: roles come from app metadata; a self-registered user must stay pending
insert into auth.users (id,email,raw_app_meta_data) values
  (gen_random_uuid(),'admin@maali.com','{"role":"admin"}'),(gen_random_uuid(),'sales@maali.com','{"role":"sales"}'),
  (gen_random_uuid(),'kitchen@maali.com','{"role":"kitchen"}'),(gen_random_uuid(),'driver@maali.com','{"role":"driver"}');
insert into auth.users (id,email,raw_user_meta_data) values (gen_random_uuid(),'evil@x.com','{"role":"admin"}');
do $$ begin assert (select role from profiles where email='evil@x.com') = 'pending', 'metadata escalation'; end $$;
do $$ begin assert (select count(*) from profiles where role<>'pending') = 4; end $$;

select as_user('sales@maali.com');
insert into customers_halls (id,name,type,payment_method,credit_limit)
  values ('00000000-0000-0000-0000-0000000000c1','قاعة المعالي الملكية','wedding_hall','deferred_credit',20000);
insert into bookings (id,customer_id,event_date,guest_count,delivery_location)
  values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1',current_date+7,150,'https://maps.example/x');
insert into booking_dishes (booking_id,recipe_id) select '00000000-0000-0000-0000-0000000000b1', id from recipes_bom;
do $$ begin
  assert (select subtotal from bookings where id='00000000-0000-0000-0000-0000000000b1') = 9750.00, 'subtotal';
  assert (select vat_amount from bookings where id='00000000-0000-0000-0000-0000000000b1') = 1462.50, 'vat';
  assert (select total_amount from bookings where id='00000000-0000-0000-0000-0000000000b1') = 11212.50, 'total';
end $$;
select expect_fail($$update bookings set status='cooking' where id='00000000-0000-0000-0000-0000000000b1'$$,'direct status update');
select expect_fail($$update bookings set total_amount=1 where id='00000000-0000-0000-0000-0000000000b1'$$,'direct total update');
select expect_fail($$update customers_halls set current_balance=0$$,'direct balance update');
select expect_fail($$select set_booking_status('00000000-0000-0000-0000-0000000000b1','cooking')$$,'sales cannot cook');
select set_booking_status('00000000-0000-0000-0000-0000000000b1','confirmed');

do $$ begin
  assert (select quantity from booking_materials where booking_id='00000000-0000-0000-0000-0000000000b1' and material_code='rice_kg') = 37.5, 'rice 150*0.25';
  assert (select quantity from booking_materials where booking_id='00000000-0000-0000-0000-0000000000b1' and material_code='meat_kg') = 52.5, 'meat';
  assert (select reserved from inventory_items where code='rice_kg') = 37.5, 'reserved';
  assert (select current_balance from customers_halls where id='00000000-0000-0000-0000-0000000000c1') = 11212.50, 'balance after invoice';
  assert (select count(*) from invoices) = 1, 'invoice';
end $$;

-- credit limit: a second 11k booking would exceed 20k
insert into bookings (id,customer_id,event_date,guest_count) values ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c1',current_date+8,150);
insert into booking_dishes (booking_id,recipe_id) select '00000000-0000-0000-0000-0000000000b2', id from recipes_bom;
select expect_fail($$select set_booking_status('00000000-0000-0000-0000-0000000000b2','confirmed')$$,'credit limit');
select expect_fail($$insert into invoices (booking_id,customer_id,subtotal,vat_amount,total_amount) values (gen_random_uuid(),'00000000-0000-0000-0000-0000000000c1',1,1,1)$$,'direct invoice insert');
select set_booking_status('00000000-0000-0000-0000-0000000000b2','cancelled');

-- payment
insert into payments (invoice_id,amount,method) select id, 5000, 'bank_transfer' from invoices;
do $$ begin
  assert (select current_balance from customers_halls where id='00000000-0000-0000-0000-0000000000c1') = 6212.50, 'balance after payment';
  assert (select status from invoices) = 'partially_paid';
end $$;
select expect_fail($$insert into payments (invoice_id,amount,method) select id, 99999, 'cash' from invoices$$,'overpayment');

-- kitchen: cook; sees materials but not money
reset role; select as_user('kitchen@maali.com');
do $$ begin assert (select count(*) from invoices) = 0, 'kitchen sees invoices'; assert (select count(*) from booking_materials) > 0; end $$;
select set_booking_status('00000000-0000-0000-0000-0000000000b1','cooking');
reset role;
do $$ begin
  assert (select stock from inventory_items where code='rice_kg') = 462.5, 'stock consumed';
  assert (select reserved from inventory_items where code='rice_kg') = 0, 'reservation cleared';
end $$;

-- driver: dispatch needs checklist; discrepancy → red status + charge
select as_user('driver@maali.com');
select expect_fail($$select set_booking_status('00000000-0000-0000-0000-0000000000b1','out_for_delivery')$$,'dispatch without checklist');
insert into asset_tracking (booking_id,asset_id,quantity_sent) select '00000000-0000-0000-0000-0000000000b1', id, 10 from catering_assets where asset_name='سخان بوفيه كبير';
do $$ begin assert (select available_stock from catering_assets where asset_name='سخان بوفيه كبير') = 30; end $$;
select set_booking_status('00000000-0000-0000-0000-0000000000b1','out_for_delivery');
select set_booking_status('00000000-0000-0000-0000-0000000000b1','delivered');
select expect_fail($$select set_booking_status('00000000-0000-0000-0000-0000000000b1','completed')$$,'complete without inbound');
update asset_tracking set quantity_returned = 8;
do $$ begin assert (select status from asset_tracking) = 'partially_returned'; end $$;
update asset_tracking set inbound_confirmed = true;
reset role;
do $$ begin
  assert (select status from asset_tracking) = 'lost_discrepancy';
  assert (select discrepancy_charge from asset_tracking) = 700, 'charge 2*350';
  assert (select current_balance from customers_halls where id='00000000-0000-0000-0000-0000000000c1') = 6912.50, 'balance incl. asset charge';
  assert (select total_stock from catering_assets where asset_name='سخان بوفيه كبير') = 38;
  assert (select available_stock from catering_assets where asset_name='سخان بوفيه كبير') = 38;
end $$;
select as_user('driver@maali.com'); select set_booking_status('00000000-0000-0000-0000-0000000000b1','completed'); reset role;
select as_user('admin@maali.com'); select 1 from profiles; reset role;
select as_user('evil@x.com');
do $$ begin assert (select count(*) from bookings) = 0, 'pending user sees data'; end $$;
reset role;

-- low stock alert
update inventory_items set stock=50, reserved=0 where code='meat_kg';
select as_user('sales@maali.com');
insert into bookings (id,customer_id,event_date,guest_count) values ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c1',current_date+9,100);
insert into booking_dishes (booking_id,recipe_id) select '00000000-0000-0000-0000-0000000000b3', id from recipes_bom;
update customers_halls set credit_limit = 100000;
select set_booking_status('00000000-0000-0000-0000-0000000000b3','confirmed');
reset role;
do $$ begin assert (select count(*) from inventory_alerts where material_code='meat_kg' and not resolved) = 1, 'alert'; end $$;
\echo ALL TESTS PASSED
