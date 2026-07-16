-- 001_initial_schema.sql
-- Safe initial Supabase schema for the NahVersorgt migration.
-- This file is intentionally created only as a repository artifact.
-- It must be executed manually in the Supabase SQL editor later.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  role text not null default 'farmer_pending'
    check (role in ('visitor','farmer_pending','farmer_verified','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  region text,
  location_text text,
  address text,
  postal_code text,
  city text,
  latitude double precision,
  longitude double precision,
  phone text,
  whatsapp text,
  email text,
  website text,
  delivery boolean not null default false,
  delivery_radius_km integer,
  self_service boolean not null default false,
  published boolean not null default false,
  approval_state text not null default 'pending'
    check (approval_state in ('pending','approved','rejected')),
  legacy_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.farm_owners (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','active','revoked')),
  is_primary_owner boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, profile_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null,
  category text,
  price numeric(10,2),
  unit text,
  description text,
  availability text,
  published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opening_hours (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time,
  closes_at time,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.farm_images (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  storage_path text not null,
  caption text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  farm_id uuid references public.farms(id) on delete set null,
  request_type text not null check (
    request_type in ('register_farm','claim_existing_farm','owner_change','critical_field_change')
  ),
  requested_changes jsonb not null default '{}'::jsonb,
  current_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  admin_note text,
  requested_by_profile_id uuid not null references public.profiles(id),
  reviewed_by_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.farms enable row level security;
alter table public.farm_owners enable row level security;
alter table public.products enable row level security;
alter table public.opening_hours enable row level security;
alter table public.farm_images enable row level security;
alter table public.verification_requests enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
security definer
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
set search_path = public
security definer
as $$
begin
  insert into public.profiles (id, display_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email),
    new.raw_user_meta_data ->> 'phone',
    'farmer_pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.prevent_profile_role_self_change()
returns trigger
language plpgsql
set search_path = public
security definer
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed';
  end if;

  if new.role is distinct from old.role then
    if not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'admin'
    ) then
      raise exception 'Only admins may change a user role';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_farmer_critical_farm_changes()
returns trigger
language plpgsql
set search_path = public
security definer
as $$
begin
  if auth.uid() is not null
     and exists (
       select 1
       from public.profiles p
       join public.farm_owners fo on fo.profile_id = p.id
       where fo.farm_id = old.id
         and fo.profile_id = auth.uid()
         and fo.status = 'active'
         and p.role = 'farmer_verified'
     )
     and not exists (
       select 1
       from public.profiles p
       where p.id = auth.uid()
         and p.role = 'admin'
     ) then
    if new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.address is distinct from old.address
      or new.postal_code is distinct from old.postal_code
      or new.city is distinct from old.city
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude
      or new.published is distinct from old.published
      or new.approval_state is distinct from old.approval_state
      or new.legacy_source_id is distinct from old.legacy_source_id
    then
      raise exception 'Farmers cannot directly change critical farm fields';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_farmer_owner_changes()
returns trigger
language plpgsql
set search_path = public
security definer
as $$
begin
  if auth.uid() is not null
     and exists (
       select 1
       from public.profiles p
       where p.id = auth.uid()
         and p.role = 'farmer_verified'
     )
     and not exists (
       select 1
       from public.profiles p
       where p.id = auth.uid()
         and p.role = 'admin'
     ) then
    raise exception 'Farm owner assignments are admin-only';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
drop trigger if exists trg_farms_set_updated_at on public.farms;
drop trigger if exists trg_farm_owners_set_updated_at on public.farm_owners;
drop trigger if exists trg_products_set_updated_at on public.products;
drop trigger if exists trg_opening_hours_set_updated_at on public.opening_hours;
drop trigger if exists trg_farm_images_set_updated_at on public.farm_images;
drop trigger if exists trg_verification_requests_set_updated_at on public.verification_requests;
drop trigger if exists trg_handle_new_user on auth.users;
drop trigger if exists trg_profiles_prevent_role_self_change on public.profiles;
drop trigger if exists trg_farms_prevent_farmer_critical_changes on public.farms;
drop trigger if exists trg_farm_owners_prevent_farmers_from_owner_changes on public.farm_owners;

create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger trg_farms_set_updated_at
before update on public.farms
for each row
execute function public.set_updated_at();

create trigger trg_farm_owners_set_updated_at
before update on public.farm_owners
for each row
execute function public.set_updated_at();

create trigger trg_products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

create trigger trg_opening_hours_set_updated_at
before update on public.opening_hours
for each row
execute function public.set_updated_at();

create trigger trg_farm_images_set_updated_at
before update on public.farm_images
for each row
execute function public.set_updated_at();

create trigger trg_verification_requests_set_updated_at
before update on public.verification_requests
for each row
execute function public.set_updated_at();

create trigger trg_handle_new_user
after insert on auth.users
for each row
execute function public.handle_new_user();

create trigger trg_profiles_prevent_role_self_change
before update on public.profiles
for each row
execute function public.prevent_profile_role_self_change();

create trigger trg_farms_prevent_farmer_critical_changes
before update on public.farms
for each row
execute function public.prevent_farmer_critical_farm_changes();

create trigger trg_farm_owners_prevent_farmers_from_owner_changes
before insert or update or delete on public.farm_owners
for each row
execute function public.prevent_farmer_owner_changes();

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins can manage all profiles" on public.profiles;
drop policy if exists "Visitors may read approved published farms" on public.farms;
drop policy if exists "Admins can manage farms" on public.farms;
drop policy if exists "Verified farmers can read their own farms" on public.farms;
drop policy if exists "Pending farmers may not edit public farm data" on public.farms;
drop policy if exists "Verified farmers can update own non-critical farm fields" on public.farms;
drop policy if exists "Visitors may read published farm products" on public.products;
drop policy if exists "Verified farmers can manage products of own farms" on public.products;
drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Visitors may read opening hours of published farms" on public.opening_hours;
drop policy if exists "Verified farmers can manage opening hours of own farms" on public.opening_hours;
drop policy if exists "Admins can manage opening hours" on public.opening_hours;
drop policy if exists "Visitors may read images of published farms" on public.farm_images;
drop policy if exists "Verified farmers can manage images of their own farms" on public.farm_images;
drop policy if exists "Admins can manage farm images" on public.farm_images;
drop policy if exists "Users may read their own verification requests" on public.verification_requests;
drop policy if exists "Users may create verification requests for themselves" on public.verification_requests;
drop policy if exists "Admins can manage verification requests" on public.verification_requests;
drop policy if exists "Users may read their own farm owner assignment" on public.farm_owners;
drop policy if exists "Admins can manage farm owners" on public.farm_owners;

create policy "Users can read their own profile"
on public.profiles
for select
using (id = auth.uid());

create policy "Admins can read all profiles"
on public.profiles
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Users can update their own profile"
on public.profiles
for update
using (id = auth.uid())
with check (
  id = auth.uid()
);

create policy "Admins can manage all profiles"
on public.profiles
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Visitors may read approved published farms"
on public.farms
for select
using (published = true and approval_state = 'approved');

create policy "Admins can manage farms"
on public.farms
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Verified farmers can read their own farms"
on public.farms
for select
using (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.farms.id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
);

create policy "Pending farmers may not edit public farm data"
on public.farms
for insert
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'farmer_pending'
  )
  and published = false
  and approval_state = 'pending'
);

create policy "Verified farmers can update own non-critical farm fields"
on public.farms
for update
using (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.farms.id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
)
with check (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.farms.id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
);

create policy "Visitors may read published farm products"
on public.products
for select
using (
  published = true
  and farm_id in (
    select id from public.farms where published = true and approval_state = 'approved'
  )
);

create policy "Verified farmers can manage products of own farms"
on public.products
for all
using (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.products.farm_id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
)
with check (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.products.farm_id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
);

create policy "Admins can manage products"
on public.products
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Visitors may read opening hours of published farms"
on public.opening_hours
for select
using (
  farm_id in (
    select id from public.farms where published = true and approval_state = 'approved'
  )
);

create policy "Verified farmers can manage opening hours of own farms"
on public.opening_hours
for all
using (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.opening_hours.farm_id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
)
with check (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.opening_hours.farm_id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
);

create policy "Admins can manage opening hours"
on public.opening_hours
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Visitors may read images of published farms"
on public.farm_images
for select
using (
  farm_id in (
    select id from public.farms where published = true and approval_state = 'approved'
  )
);

create policy "Verified farmers can manage images of their own farms"
on public.farm_images
for all
using (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.farm_images.farm_id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
)
with check (
  exists (
    select 1
    from public.farm_owners fo
    join public.profiles p on p.id = fo.profile_id
    where fo.farm_id = public.farm_images.farm_id
      and fo.profile_id = auth.uid()
      and fo.status = 'active'
      and p.role = 'farmer_verified'
  )
);

create policy "Admins can manage farm images"
on public.farm_images
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Users may read their own verification requests"
on public.verification_requests
for select
using (
  requested_by_profile_id = auth.uid()
  or profile_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Users may create verification requests for themselves"
on public.verification_requests
for insert
with check (
  requested_by_profile_id = auth.uid()
  and profile_id = auth.uid()
);

create policy "Admins can manage verification requests"
on public.verification_requests
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Users may read their own farm owner assignment"
on public.farm_owners
for select
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

create policy "Admins can manage farm owners"
on public.farm_owners
for all
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

grant usage on schema public to anon, authenticated;

grant select on public.farms to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.opening_hours to anon, authenticated;
grant select on public.farm_images to anon, authenticated;

revoke all on public.profiles from authenticated;
grant select, update on public.profiles to authenticated;
revoke all on public.products from authenticated;
grant select, insert, update, delete on public.products to authenticated;
revoke all on public.opening_hours from authenticated;
grant select, insert, update, delete on public.opening_hours to authenticated;
revoke all on public.farm_images from authenticated;
grant select, insert, update, delete on public.farm_images to authenticated;
revoke all on public.verification_requests from authenticated;
grant select, insert on public.verification_requests to authenticated;
revoke all on public.farm_owners from authenticated;
grant select on public.farm_owners to authenticated;
revoke all on public.farms from authenticated;
grant select, insert, update on public.farms to authenticated;

grant usage, select on all sequences in schema public to authenticated;

commit;

-- Storage bucket note:
-- A future storage bucket named "farm-images" will be required for uploaded farm photos.
-- This migration intentionally does not create any bucket automatically.
