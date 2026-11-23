-- Step 2: per-project push automation, delivery idempotency and live workspace refresh.
alter table public.projects
  add column if not exists scan_on_push boolean not null default true;

alter table public.scans
  add column if not exists trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'push')),
  add column if not exists webhook_delivery_id text;

create unique index if not exists scans_project_webhook_delivery_unique
  on public.scans(project_id, webhook_delivery_id)
  where webhook_delivery_id is not null;

comment on column public.projects.scan_on_push is
  'When true, verified pushes to the configured default branch enqueue an automatic scan.';
comment on column public.scans.trigger_source is
  'Origin of the scan: manual request or a GitHub push delivery.';
comment on column public.scans.webhook_delivery_id is
  'GitHub X-GitHub-Delivery identifier used to make push webhook handling idempotent per project.';

-- Dashboard subscribers listen for project changes; scan changes are already
-- published by migration 0004. Existing RLS policies continue to govern reads.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'projects'
     ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end;
$$;
