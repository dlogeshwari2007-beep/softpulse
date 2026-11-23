-- Step 3: workspace activity stream, per-user notifications and alert preferences.

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  scan_completed_enabled boolean not null default true,
  scan_failed_enabled boolean not null default true,
  health_drop_enabled boolean not null default true,
  health_drop_threshold numeric(5,2) not null default 5
    check (health_drop_threshold >= 1 and health_drop_threshold <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'project_added','scan_queued','scan_started','scan_completed',
    'scan_failed','scan_cancelled','health_drop'
  )),
  title text not null,
  message text not null,
  project_id uuid references public.projects(id) on delete set null,
  scan_id uuid references public.scans(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_created_at_idx
  on public.activity_events(created_at desc);
create index if not exists activity_events_project_created_at_idx
  on public.activity_events(project_id, created_at desc);
create index if not exists activity_events_scan_idx
  on public.activity_events(scan_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_event_id uuid not null references public.activity_events(id) on delete cascade,
  notification_type text not null check (notification_type in ('scan_completed','scan_failed','health_drop')),
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, activity_event_id)
);

create index if not exists notifications_user_created_at_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, created_at desc)
  where read_at is null;

create or replace function public.set_notification_preferences_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_notification_preferences_updated_at();

create or replace function public.provision_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences(user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_notification_preferences on auth.users;
create trigger on_auth_user_notification_preferences
after insert on auth.users
for each row execute function public.provision_notification_preferences();

insert into public.notification_preferences(user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.record_workspace_activity(
  p_event_type text,
  p_title text,
  p_message text,
  p_project_id uuid default null,
  p_scan_id uuid default null,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_event_id uuid;
begin
  insert into public.activity_events(
    event_type, title, message, project_id, scan_id, actor_id, metadata
  )
  values (
    p_event_type, p_title, p_message, p_project_id, p_scan_id, p_actor_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into new_event_id;

  return new_event_id;
end;
$$;

revoke all on function public.record_workspace_activity(text,text,text,uuid,uuid,uuid,jsonb) from public;

create or replace function public.log_project_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_workspace_activity(
    'project_added',
    'Repository connected',
    'A GitHub repository was added to the SoftPulse workspace.',
    new.id,
    null,
    new.owner_id,
    jsonb_build_object('repository_name', new.name, 'repository_url', new.repo_url)
  );
  return new;
end;
$$;

drop trigger if exists projects_activity_insert on public.projects;
create trigger projects_activity_insert
after insert on public.projects
for each row execute function public.log_project_activity();

create or replace function public.log_scan_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_name text;
  event_id uuid;
  prior_score numeric;
  score_drop numeric;
  recipient record;
  scan_title text;
  scan_message text;
begin
  select name into project_name
  from public.projects
  where id = new.project_id;

  if tg_op = 'INSERT' then
    if new.status = 'queued' then
      perform public.record_workspace_activity(
        'scan_queued',
        'Scan queued',
        coalesce(project_name, 'Repository') || ' has a new scan in the queue.',
        new.project_id, new.id, new.started_by,
        jsonb_build_object('trigger_source', coalesce(new.trigger_source, 'manual'))
      );
    end if;
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if old.status = 'queued' and new.status = 'running' then
    perform public.record_workspace_activity(
      'scan_started',
      'Scan started',
      coalesce(project_name, 'Repository') || ' is being analysed.',
      new.project_id, new.id, new.started_by,
      jsonb_build_object('trigger_source', coalesce(new.trigger_source, 'manual'))
    );
    return new;
  end if;

  if new.status not in ('completed','failed','cancelled') then
    return new;
  end if;

  if new.status = 'completed' then
    scan_title := 'Scan completed';
    scan_message := coalesce(project_name, 'Repository') || ' completed its software health assessment.';
  elsif new.status = 'failed' then
    scan_title := 'Scan failed';
    scan_message := coalesce(project_name, 'Repository') || ' could not complete its assessment.';
  else
    scan_title := 'Scan cancelled';
    scan_message := coalesce(project_name, 'Repository') || ' scan was cancelled.';
  end if;

  event_id := public.record_workspace_activity(
    case new.status
      when 'completed' then 'scan_completed'
      when 'failed' then 'scan_failed'
      else 'scan_cancelled'
    end,
    scan_title,
    scan_message,
    new.project_id,
    new.id,
    new.started_by,
    jsonb_build_object(
      'health_score', new.health_score,
      'grade', new.grade,
      'trigger_source', coalesce(new.trigger_source, 'manual'),
      'commit_sha', new.commit_sha
    )
  );

  if new.status = 'failed' then
    insert into public.notifications(user_id, activity_event_id, notification_type, title, message)
    select p.user_id, event_id, 'scan_failed', 'Scan failed', scan_message
    from public.notification_preferences p
    where p.scan_failed_enabled
    on conflict (user_id, activity_event_id) do nothing;
    return new;
  end if;

  if new.status <> 'completed' then
    return new;
  end if;

  insert into public.notifications(user_id, activity_event_id, notification_type, title, message)
  select p.user_id, event_id, 'scan_completed',
    'Scan completed',
    coalesce(project_name, 'Repository') || ' scored ' ||
      coalesce(new.health_score::text, '—') || '/100 (Grade ' ||
      coalesce(new.grade::text, '—') || ').'
  from public.notification_preferences p
  where p.scan_completed_enabled
  on conflict (user_id, activity_event_id) do nothing;

  if new.health_score is not null then
    select s.health_score into prior_score
    from public.scans s
    where s.project_id = new.project_id
      and s.id <> new.id
      and s.status = 'completed'
      and s.health_score is not null
    order by s.completed_at desc nulls last, s.created_at desc
    limit 1;

    if prior_score is not null then
      score_drop := prior_score - new.health_score;
      if score_drop >= 1 then
        event_id := public.record_workspace_activity(
          'health_drop',
          'Health score decreased',
          coalesce(project_name, 'Repository') || ' health score dropped by ' ||
            round(score_drop, 1)::text || ' points.',
          new.project_id,
          new.id,
          new.started_by,
          jsonb_build_object(
            'previous_score', prior_score,
            'current_score', new.health_score,
            'drop', round(score_drop, 2)
          )
        );

        insert into public.notifications(user_id, activity_event_id, notification_type, title, message)
        select p.user_id, event_id, 'health_drop',
          'Health score decreased',
          coalesce(project_name, 'Repository') || ' dropped from ' ||
            round(prior_score, 1)::text || ' to ' ||
            round(new.health_score, 1)::text || '/100.'
        from public.notification_preferences p
        where p.health_drop_enabled
          and score_drop >= p.health_drop_threshold
        on conflict (user_id, activity_event_id) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists scans_activity_stream on public.scans;
create trigger scans_activity_stream
after insert or update of status on public.scans
for each row execute function public.log_scan_activity();

alter table public.notification_preferences enable row level security;
alter table public.activity_events enable row level security;
alter table public.notifications enable row level security;

drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own
on public.notification_preferences for select to authenticated
using (user_id = auth.uid());

drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own
on public.notification_preferences for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists activity_events_select_authenticated on public.activity_events;
create policy activity_events_select_authenticated
on public.activity_events for select to authenticated
using (true);

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications for select to authenticated
using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, update(scan_completed_enabled, scan_failed_enabled, health_drop_enabled, health_drop_threshold)
  on public.notification_preferences to authenticated;
grant select on public.activity_events to authenticated;
grant select, update(read_at) on public.notifications to authenticated;

-- Only database triggers can create activity records or notifications.
revoke insert, delete, update on public.activity_events from authenticated;
revoke insert, delete on public.notifications from authenticated;

-- The feed and bell update live in other open tabs.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'activity_events'
    ) then
      alter publication supabase_realtime add table public.activity_events;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end;
$$;
