-- 005_farm_image_management.sql
-- Secure farm image management for the NahVersorgt photo workflow.
-- This migration is intentionally created only as a repository artifact.
-- It must be executed manually in the Supabase SQL editor later.

begin;

create schema if not exists private;

grant usage on schema private to anon, authenticated;

do $$
begin
  if exists (
    select 1
    from public.farm_images
    where is_primary = true
    group by farm_id
    having count(*) > 1
  ) then
    raise exception 'Existing farms have multiple primary images';
  end if;

  if exists (
    select 1
    from public.farm_images
    group by farm_id
    having count(*) > 10
  ) then
    raise exception 'Existing farms have more than 10 images';
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'farm-images',
  'farm-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.current_user_can_manage_farm_images(
  p_farm_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_is_admin()
    or exists (
      select 1
      from public.farm_owners fo
      join public.profiles p on p.id = fo.profile_id
      where fo.farm_id = p_farm_id
        and fo.profile_id = auth.uid()
        and fo.status = 'active'
        and p.role = 'farmer_verified'
    );
$$;

alter function private.current_user_can_manage_farm_images(uuid) owner to postgres;

revoke all on function private.current_user_can_manage_farm_images(uuid) from public;
revoke all on function private.current_user_can_manage_farm_images(uuid) from anon;
revoke all on function private.current_user_can_manage_farm_images(uuid) from authenticated;
grant execute on function private.current_user_can_manage_farm_images(uuid) to authenticated;

create or replace function private.is_valid_farm_image_path(
  p_object_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return p_object_name ~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.(jpe?g|png|webp)$';
end;
$$;

alter function private.is_valid_farm_image_path(text) owner to postgres;

revoke all on function private.is_valid_farm_image_path(text) from public;
revoke all on function private.is_valid_farm_image_path(text) from anon;
revoke all on function private.is_valid_farm_image_path(text) from authenticated;
grant execute on function private.is_valid_farm_image_path(text) to anon;
grant execute on function private.is_valid_farm_image_path(text) to authenticated;

create or replace function private.storage_object_farm_id(
  p_object_name text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid;
begin
  if not private.is_valid_farm_image_path(p_object_name) then
    return null;
  end if;

  begin
    v_farm_id := nullif(split_part(coalesce(p_object_name, ''), '/', 1), '')::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;

  return v_farm_id;
end;
$$;

alter function private.storage_object_farm_id(text) owner to postgres;

revoke all on function private.storage_object_farm_id(text) from public;
revoke all on function private.storage_object_farm_id(text) from anon;
revoke all on function private.storage_object_farm_id(text) from authenticated;
grant execute on function private.storage_object_farm_id(text) to anon;
grant execute on function private.storage_object_farm_id(text) to authenticated;

drop policy if exists "Visitors may read images of published farms" on public.farm_images;
drop policy if exists "Verified farmers can manage images of their own farms" on public.farm_images;
drop policy if exists "Admins can manage farm images" on public.farm_images;
drop policy if exists "Public can read published farm images" on public.farm_images;
drop policy if exists "Farm owners and admins can manage farm images" on public.farm_images;

create policy "Public can read published farm images"
on public.farm_images
for select
using (
  exists (
    select 1
    from public.farms f
    where f.id = public.farm_images.farm_id
      and f.published = true
      and f.approval_state = 'approved'
  )
);

create policy "Farm owners and admins can manage farm images"
on public.farm_images
for all
using (
  private.current_user_can_manage_farm_images(public.farm_images.farm_id)
)
with check (
  private.current_user_can_manage_farm_images(public.farm_images.farm_id)
);

create unique index if not exists farm_images_one_primary_per_farm_idx
on public.farm_images (farm_id)
where is_primary = true;

create or replace function public.enforce_farm_image_constraints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_image_count integer;
begin
  if tg_op = 'UPDATE'
     and (
       new.farm_id is distinct from old.farm_id
       or new.storage_path is distinct from old.storage_path
     ) then
    raise exception 'Farm image identity fields cannot be changed';
  end if;

  if new.storage_path is null
     or not private.is_valid_farm_image_path(new.storage_path)
     or private.storage_object_farm_id(new.storage_path) is distinct from new.farm_id then
    raise exception 'Invalid farm image storage path';
  end if;

  if tg_op = 'INSERT' then
    perform 1
    from public.farms
    where id = new.farm_id
    for update;

    if not found then
      raise exception 'Farm not found';
    end if;

    select count(*)
    into v_image_count
    from public.farm_images
    where farm_id = new.farm_id;

    if v_image_count = 0 then
      new.is_primary := true;
    end if;

    if v_image_count >= 10 then
      raise exception 'A farm can have at most 10 images';
    end if;
  end if;

  if new.is_primary
     and exists (
       select 1
       from public.farm_images
       where farm_id = new.farm_id
         and is_primary = true
         and (tg_op = 'INSERT' or id <> old.id)
     ) then
    raise exception 'A farm can have only one primary image';
  end if;

  return new;
end;
$$;

alter function public.enforce_farm_image_constraints() owner to postgres;

revoke all on function public.enforce_farm_image_constraints() from public;
revoke all on function public.enforce_farm_image_constraints() from anon;
revoke all on function public.enforce_farm_image_constraints() from authenticated;

drop trigger if exists trg_farm_images_enforce_constraints on public.farm_images;

create trigger trg_farm_images_enforce_constraints
before insert or update on public.farm_images
for each row
execute function public.enforce_farm_image_constraints();

drop trigger if exists trg_farm_images_promote_primary on public.farm_images;

create or replace function public.promote_farm_image_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_primary then
    update public.farm_images
    set is_primary = true,
        updated_at = now()
    where id = (
      select id
      from public.farm_images
      where farm_id = old.farm_id
      order by sort_order asc, created_at asc, id asc
      limit 1
    )
      and not exists (
        select 1
        from public.farm_images
        where farm_id = old.farm_id
          and is_primary = true
      );
  end if;

  return null;
end;
$$;

alter function public.promote_farm_image_after_delete() owner to postgres;

revoke all on function public.promote_farm_image_after_delete() from public;
revoke all on function public.promote_farm_image_after_delete() from anon;
revoke all on function public.promote_farm_image_after_delete() from authenticated;

create trigger trg_farm_images_promote_primary
after delete on public.farm_images
for each row
execute function public.promote_farm_image_after_delete();

create or replace function public.set_farm_image_primary(
  p_image_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_image record;
begin
  select
    farm_id
  into v_image
  from public.farm_images
  where id = p_image_id;

  if not found then
    raise exception 'Farm image not found';
  end if;

  perform 1
  from public.farms
  where id = v_image.farm_id
  for update;

  if not found then
    raise exception 'Farm not found';
  end if;

  select
    id,
    farm_id
  into v_image
  from public.farm_images
  where id = p_image_id
  for update;

  if not found then
    raise exception 'Farm image not found';
  end if;

  if not private.current_user_can_manage_farm_images(v_image.farm_id) then
    raise exception 'Not allowed to manage this farm image';
  end if;

  update public.farm_images
  set is_primary = false,
      updated_at = now()
  where farm_id = v_image.farm_id
    and id <> v_image.id;

  update public.farm_images
  set is_primary = true,
      updated_at = now()
  where id = v_image.id;

  if not found then
    raise exception 'Farm image could not be updated';
  end if;
end;
$$;

alter function public.set_farm_image_primary(uuid) owner to postgres;

revoke all on function public.set_farm_image_primary(uuid) from public;
revoke all on function public.set_farm_image_primary(uuid) from anon;
revoke all on function public.set_farm_image_primary(uuid) from authenticated;
grant execute on function public.set_farm_image_primary(uuid) to authenticated;

drop policy if exists "Public can read published farm images" on storage.objects;
drop policy if exists "Farm owners and admins can upload farm images" on storage.objects;
drop policy if exists "Farm owners and admins can delete farm images" on storage.objects;
drop policy if exists "Farm owners and admins can read managed farm images" on storage.objects;

create policy "Public can read published farm images"
on storage.objects
for select
using (
  bucket_id = 'farm-images'
  and private.is_valid_farm_image_path(name)
  and exists (
    select 1
    from public.farms f
    where f.id = private.storage_object_farm_id(name)
      and f.published = true
      and f.approval_state = 'approved'
  )
);

create policy "Farm owners and admins can read managed farm images"
on storage.objects
for select
using (
  bucket_id = 'farm-images'
  and private.is_valid_farm_image_path(name)
  and private.current_user_can_manage_farm_images(
    private.storage_object_farm_id(name)
  )
);

create policy "Farm owners and admins can upload farm images"
on storage.objects
for insert
with check (
  bucket_id = 'farm-images'
  and private.is_valid_farm_image_path(name)
  and private.current_user_can_manage_farm_images(private.storage_object_farm_id(name))
);

create policy "Farm owners and admins can delete farm images"
on storage.objects
for delete
using (
  bucket_id = 'farm-images'
  and private.is_valid_farm_image_path(name)
  and private.current_user_can_manage_farm_images(private.storage_object_farm_id(name))
);

commit;
