-- Step 1: Realtime scan progress and cooperative cancellation.
alter table public.scans
  add column if not exists progress_log jsonb not null default '[]'::jsonb,
  add column if not exists cancelled_at timestamptz;

comment on column public.scans.progress_log is
  'Bounded chronological log of scan stages, file measurements and metric scoring progress.';
comment on column public.scans.cancelled_at is
  'Timestamp when an authorized workspace member cancelled an in-flight scan.';

-- Supabase Realtime publishes scan row changes to subscribed clients.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'scans'
     ) then
    alter publication supabase_realtime add table public.scans;
  end if;
end;
$$;

-- RLS policies from 0001_base_schema.sql continue to govern reads and writes.
-- No extra table is introduced for streaming logs; the scan row is the single
-- Realtime source of truth.
