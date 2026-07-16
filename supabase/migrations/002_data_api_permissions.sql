-- 002_data_api_permissions.sql
-- Minimal data API permissions for the NahVersorgt Supabase migration.
-- This file must be executed manually in the Supabase SQL editor later.
-- It intentionally does not change the existing 001 schema or RLS policies.

begin;

grant usage on schema public to anon, authenticated;

-- Public visitors: read-only access to published and approved data via RLS.
grant select on public.farms to anon;
grant select on public.products to anon;
grant select on public.opening_hours to anon;
grant select on public.farm_images to anon;

-- Authenticated users: minimal write access needed for the app workflow.
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.farms to authenticated;
grant select on public.farm_owners to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.opening_hours to authenticated;
grant select, insert, update, delete on public.farm_images to authenticated;
grant select, insert on public.verification_requests to authenticated;

-- No sequence grants are needed because the schema uses UUIDs and gen_random_uuid().
-- The Data API does not require explicit sequence privileges for UUID primary keys.

-- No helper function EXECUTE grants are added here.
-- Helper functions used by RLS remain callable only through the RLS mechanism,
-- and are not exposed for public execution.

commit;
