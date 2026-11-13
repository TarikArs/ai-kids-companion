-- Privacy (2026-11-11): what the privacy policy promises.
--   1. The parent's consent is recorded (date + version of the texts) when the family is created.
--   2. Two service-role-only helpers to list storage files (used by purge-old and delete-account).
--   3. A daily job calls the purge-old function: photos, transcripts, Silia's messages and logs older than
--      30 days are deleted.
-- Run once in the SQL Editor, AFTER deploying the purge-old function and storing its token in the Vault
-- (see the end of this file).

-- 1. Consent -----------------------------------------------------------------------------------------------
alter table public.households
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

-- 2. Storage helpers (storage schema is not exposed to the API) ----------------------------------------------
create or replace function public.storage_objects_before(p_bucket text, p_before timestamptz, p_limit int default 2000)
returns table (name text)
language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = p_bucket and o.created_at < p_before
  order by o.created_at
  limit p_limit;
$$;

create or replace function public.household_storage_objects(p_bucket text, p_household uuid)
returns table (name text)
language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = p_bucket and o.name like p_household::text || '/%';
$$;

revoke all on function public.storage_objects_before(text, timestamptz, int) from public, anon, authenticated;
revoke all on function public.household_storage_objects(text, uuid) from public, anon, authenticated;
grant execute on function public.storage_objects_before(text, timestamptz, int) to service_role;
grant execute on function public.household_storage_objects(text, uuid) to service_role;

-- 3. Daily purge -------------------------------------------------------------------------------------------
-- Needs, once, in the SQL Editor (the token is never written in the repo):
--   select vault.create_secret('<same value as PURGE_TOKEN>', 'purge_token');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('purge-old-daily') where exists (select 1 from cron.job where jobname = 'purge-old-daily');
select cron.schedule(
  'purge-old-daily',
  '17 3 * * *', -- every day at 03:17 UTC
  $$
  select net.http_post(
    url := 'https://qvuelnmvapbkybxbqkvn.supabase.co/functions/v1/purge-old',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-admin-token', (select decrypted_secret from vault.decrypted_secrets where name = 'purge_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
