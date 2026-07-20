-- 003_fix_profiles_rls_recursion.sql
-- Fixes recursive RLS evaluation for admin checks on profiles and related tables.
-- This migration only updates policies and helper functions. It does not change data.

begin;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where public.profiles.id = auth.uid()
      and public.profiles.role = 'admin'
  );
$$;

alter function private.current_user_is_admin() owner to postgres;

revoke all on function private.current_user_is_admin() from public;
revoke all on function private.current_user_is_admin() from anon;
revoke all on function private.current_user_is_admin() from authenticated;
grant execute on function private.current_user_is_admin() to authenticated;

drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Admins can manage all profiles" on public.profiles;
drop policy if exists "Admins can manage farms" on public.farms;
drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Admins can manage opening hours" on public.opening_hours;
drop policy if exists "Admins can manage farm images" on public.farm_images;
drop policy if exists "Admins can manage verification requests" on public.verification_requests;
drop policy if exists "Admins can manage farm owners" on public.farm_owners;

create policy "Admins can read all profiles"
on public.profiles
for select
using (private.current_user_is_admin());

create policy "Admins can manage all profiles"
on public.profiles
for all
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy "Admins can manage farms"
on public.farms
for all
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy "Admins can manage products"
on public.products
for all
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy "Admins can manage opening hours"
on public.opening_hours
for all
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy "Admins can manage farm images"
on public.farm_images
for all
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy "Admins can manage verification requests"
on public.verification_requests
for all
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

create policy "Admins can manage farm owners"
on public.farm_owners
for all
using (private.current_user_is_admin())
with check (private.current_user_is_admin());

commit;
