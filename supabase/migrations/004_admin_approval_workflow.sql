-- 004_admin_approval_workflow.sql
-- Secure admin approval workflow for verification requests.

begin;

do $$
begin
  if exists (
    select 1
    from public.farm_owners
    where is_primary_owner = true
      and status = 'active'
    group by farm_id
    having count(*) > 1
  ) then
    raise exception 'Existing farms have multiple active primary owners';
  end if;
end
$$;

create unique index if not exists
  farm_owners_one_active_primary_owner_per_farm_idx
on public.farm_owners (farm_id)
where is_primary_owner = true
  and status = 'active';

create or replace function public.approve_existing_farm_claim(
  p_request_id uuid,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
begin
  if not private.current_user_is_admin() then
    raise exception 'Admin privileges required';
  end if;

  select
    id,
    profile_id,
    requested_by_profile_id,
    farm_id,
    request_type,
    status
  into v_request
  from public.verification_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Verification request not found';
  end if;

  if v_request.request_type <> 'claim_existing_farm' then
    raise exception 'Verification request is not a farm claim';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Verification request is not pending';
  end if;

  if v_request.profile_id is null
     or v_request.requested_by_profile_id is null
     or v_request.farm_id is null then
    raise exception 'Verification request is missing required references';
  end if;

  if v_request.profile_id <> v_request.requested_by_profile_id then
    raise exception 'Verification request profile mismatch';
  end if;

  perform 1
  from public.farms
  where id = v_request.farm_id
  for update;

  if not found then
    raise exception 'Farm not found';
  end if;

  if exists (
    select 1
    from public.farm_owners
    where farm_id = v_request.farm_id
      and profile_id <> v_request.profile_id
      and is_primary_owner = true
      and status = 'active'
  ) then
    raise exception 'Farm already has another active primary owner';
  end if;

  insert into public.farm_owners (
    farm_id,
    profile_id,
    status,
    is_primary_owner
  )
  values (
    v_request.farm_id,
    v_request.profile_id,
    'active',
    true
  )
  on conflict (farm_id, profile_id)
  do update set
    status = excluded.status,
    is_primary_owner = excluded.is_primary_owner,
    updated_at = now();

  update public.profiles
  set role = case
        when role = 'admin' then 'admin'
        else 'farmer_verified'
      end,
      updated_at = now()
  where id = v_request.profile_id;

  if not found then
    raise exception 'Applicant profile not found';
  end if;

  update public.verification_requests
  set status = 'approved',
      reviewed_by_profile_id = auth.uid(),
      reviewed_at = now(),
      admin_note = p_admin_note,
      updated_at = now()
  where id = v_request.id;

  if not found then
    raise exception 'Verification request could not be updated';
  end if;
end;
$$;

alter function public.approve_existing_farm_claim(uuid, text) owner to postgres;

revoke all on function public.approve_existing_farm_claim(uuid, text) from public;
revoke all on function public.approve_existing_farm_claim(uuid, text) from anon;
revoke all on function public.approve_existing_farm_claim(uuid, text) from authenticated;
grant execute on function public.approve_existing_farm_claim(uuid, text) to authenticated;

create or replace function public.reject_verification_request(
  p_request_id uuid,
  p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
begin
  if not private.current_user_is_admin() then
    raise exception 'Admin privileges required';
  end if;

  select
    id,
    request_type,
    status
  into v_request
  from public.verification_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Verification request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Verification request is not pending';
  end if;

  update public.verification_requests
  set status = 'rejected',
      reviewed_by_profile_id = auth.uid(),
      reviewed_at = now(),
      admin_note = p_admin_note,
      updated_at = now()
  where id = v_request.id;

  if not found then
    raise exception 'Verification request could not be updated';
  end if;
end;
$$;

alter function public.reject_verification_request(uuid, text) owner to postgres;

revoke all on function public.reject_verification_request(uuid, text) from public;
revoke all on function public.reject_verification_request(uuid, text) from anon;
revoke all on function public.reject_verification_request(uuid, text) from authenticated;
grant execute on function public.reject_verification_request(uuid, text) to authenticated;

commit;