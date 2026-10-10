# Deploying the staff portal (Hostinger + WordPress)

## 1. Supabase
1. Create a project at supabase.com. Apply `supabase/migrations/*.sql` (SQL editor or `supabase db push`), then `supabase/seed.sql`.
2. Create staff users: Authentication → Users → Add user. Then in the SQL editor set the role, e.g.
   `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email='you@…';`
   `update public.profiles set role='admin' where email='you@…';`
   (the profile row is created on signup with role `pending`; the second statement is what grants access.)
3. Authentication → URL Configuration: set Site URL to the portal URL.

## 2. Portal on Hostinger (Node.js app)
Use a subdomain such as `app.almaalicatering.com`:
1. hPanel → Websites → Add website → Node.js Apps; import this repo, root directory `almaali-erp/web`.
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`). Never add the service_role key.
3. Build `npm run build`, start `npm start`.

## 3. Login link in the WordPress menu (not a visible button)
Appearance → Menus → *Custom Links*: URL = the portal URL, Link text = «دخول الموظفين».
Add it to the footer menu (or the primary menu, last item) so it stays discreet; optionally give it the
CSS class `staff-login` (Screen Options → CSS Classes) to restyle it smaller.
