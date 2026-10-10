-- Reference data (safe for any environment).
insert into inventory_items (code, name, unit, stock, safety_level) values
  ('rice_kg',  'أرز بسمتي', 'kg', 500, 100),
  ('meat_kg',  'لحم غنم',   'kg', 400, 80),
  ('ghee_kg',  'سمن',       'kg', 60,  15),
  ('spices_g', 'بهارات',    'g',  20000, 3000)
on conflict do nothing;

insert into recipes_bom (dish_name, base_serving_size, price_per_serving, ingredients_json) values
  ('كابلي لحم غنم', 1, 65.00, '{"rice_kg":0.25,"meat_kg":0.35,"ghee_kg":0.03,"spices_g":15}')
on conflict do nothing;

insert into catering_assets (asset_name, total_stock, available_stock, replacement_cost) values
  ('سخان بوفيه كبير', 40, 40, 350),
  ('طاولات استقبال',  60, 60, 200),
  ('أطقم فضيات',      100, 100, 120)
on conflict do nothing;
