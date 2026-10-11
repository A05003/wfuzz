-- DEVELOPMENT ONLY. Creates the four demo staff accounts from the PRD with a weak
-- password. Never run against production: create real users in Supabase Auth
-- (Dashboard → Authentication → Add user) and set app_metadata {"role": "..."}.
do $$
declare r record; uid uuid;
begin
  for r in select * from (values
    ('admin@maali.com','admin'),('sales@maali.com','sales'),
    ('kitchen@maali.com','kitchen'),('driver@maali.com','driver')) v(email, role)
  loop
    if not exists (select 1 from auth.users where email = r.email) then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change, email_change_token_new)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
              crypt('password', gen_salt('bf')), now(),
              jsonb_build_object('provider','email','providers',array['email'],'role',r.role), '{}'::jsonb, now(), now(),
              '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', r.email), 'email', now(), now(), now());
    end if;
  end loop;
end $$;
