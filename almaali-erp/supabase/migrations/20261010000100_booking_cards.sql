-- Money-free booking view for kitchen/driver (they cannot read customers_halls or totals).
create view booking_cards as
  select b.id, b.event_date, b.event_time, b.guest_count, b.status, b.delivery_location, c.name as customer_name
    from bookings b join customers_halls c on c.id = b.customer_id
   where current_app_role() in ('admin','sales','kitchen','driver');
revoke all on booking_cards from anon, public;
grant select on booking_cards to authenticated;
