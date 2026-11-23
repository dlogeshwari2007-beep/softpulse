create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'manager', 'engineer', 'viewer');
create type public.scan_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.module_risk as enum ('low', 'medium', 'high');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role public.app_role not null default 'viewer',
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  repo_url text not null,
  repo_owner text,
  repo_name text,
  default_branch text not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, repo_url)
);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  started_by uuid references auth.users(id),
  status public.scan_status not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  current_stage text,
  current_file text,
  health_score numeric(5,2) check (health_score between 0 and 100),
  grade char(1) check (grade in ('A','B','C','D','E')),
  commit_sha text,
  commit_message text,
  commit_author text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null,
  language text,
  lines_of_code integer not null default 0,
  risk public.module_risk not null default 'low',
  risk_probability numeric(5,2) not null default 0 check (risk_probability between 0 and 100),
  estimated_refactor_hours numeric(7,2) not null default 0,
  technical_debt_ratio numeric(6,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(scan_id, path)
);

create table public.metrics (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  module_id uuid references public.modules(id) on delete cascade,
  metric_key text not null,
  raw_value numeric,
  normalized_score numeric(5,2) check (normalized_score between 0 and 100),
  weight numeric(7,4) not null default 0,
  contribution numeric(8,4),
  measured_at timestamptz not null default now(),
  unique(scan_id, module_id, metric_key)
);

create table public.metric_weights (
  metric_key text primary key,
  label text not null,
  weight numeric(7,4) not null check (weight >= 0 and weight <= 1),
  direction text not null check (direction in ('higher_better','lower_better','informational')),
  explanation text not null,
  updated_at timestamptz not null default now()
);

insert into public.metric_weights(metric_key,label,weight,direction,explanation) values
('lines_of_code','Lines of code',0.04,'lower_better','Large modules are harder to understand and change.'),
('cyclomatic_complexity','Cyclomatic complexity',0.12,'lower_better','Fewer decision paths make code easier to test.'),
('maintainability_index','Maintainability index',0.14,'higher_better','A composite indicator of how easy code is to maintain.'),
('duplication_pct','Duplication',0.10,'lower_better','Repeated code increases the cost of every change.'),
('code_smells','Code smells',0.10,'lower_better','Potential design and implementation problems.'),
('comment_ratio','Comment ratio',0.04,'higher_better','Useful comments improve context when code is not self-explanatory.'),
('function_length','Function length',0.08,'lower_better','Short focused functions are easier to reason about.'),
('nesting_depth','Nesting depth',0.08,'lower_better','Shallow control flow is easier to follow.'),
('test_coverage_pct','Test coverage',0.12,'higher_better','Coverage indicates how much code is exercised by tests.'),
('test_to_code_ratio','Test-to-code ratio',0.06,'higher_better','A healthy test suite provides a safety net for change.'),
('outdated_dependencies','Outdated dependencies',0.06,'lower_better','Old dependencies can increase maintenance effort.'),
('vulnerable_dependencies','Vulnerable dependencies',0.06,'lower_better','Known vulnerabilities increase security exposure.')
on conflict (metric_key) do nothing;

create or replace function public.has_role(required_roles public.app_role[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = any(required_roles));
$$;

revoke all on function public.has_role(public.app_role[]) from public;
grant execute on function public.has_role(public.app_role[]) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare initial_role public.app_role;
begin
  insert into public.profiles(id, email, display_name)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'display_name',''));
  if not exists (select 1 from public.user_roles) then initial_role := 'admin';
  else initial_role := 'viewer'; end if;
  insert into public.user_roles(user_id, role) values (new.id, initial_role);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.projects enable row level security;
alter table public.scans enable row level security;
alter table public.modules enable row level security;
alter table public.metrics enable row level security;
alter table public.metric_weights enable row level security;

create policy "profiles_select_self_or_admin" on public.profiles for select to authenticated
using (id = auth.uid() or public.has_role(array['admin']::public.app_role[]));
create policy "profiles_update_self_or_admin" on public.profiles for update to authenticated
using (id = auth.uid() or public.has_role(array['admin']::public.app_role[]))
with check (id = auth.uid() or public.has_role(array['admin']::public.app_role[]));

create policy "roles_select_authenticated" on public.user_roles for select to authenticated using (true);
create policy "roles_admin_insert" on public.user_roles for insert to authenticated
with check (public.has_role(array['admin']::public.app_role[]));
create policy "roles_admin_update" on public.user_roles for update to authenticated
using (public.has_role(array['admin']::public.app_role[]))
with check (public.has_role(array['admin']::public.app_role[]));
create policy "roles_admin_delete" on public.user_roles for delete to authenticated
using (public.has_role(array['admin']::public.app_role[]));

create policy "projects_select" on public.projects for select to authenticated using (true);
create policy "projects_insert" on public.projects for insert to authenticated
with check (public.has_role(array['admin','manager','engineer']::public.app_role[]) and owner_id = auth.uid());
create policy "projects_update" on public.projects for update to authenticated
using (public.has_role(array['admin','manager','engineer']::public.app_role[]))
with check (public.has_role(array['admin','manager','engineer']::public.app_role[]));
create policy "projects_delete_admin_manager" on public.projects for delete to authenticated
using (public.has_role(array['admin','manager']::public.app_role[]));

create policy "scans_select" on public.scans for select to authenticated using (true);
create policy "scans_insert_engineering_roles" on public.scans for insert to authenticated
with check (public.has_role(array['admin','manager','engineer']::public.app_role[]) and started_by = auth.uid());
create policy "scans_update_engineering_roles" on public.scans for update to authenticated
using (public.has_role(array['admin','manager','engineer']::public.app_role[]))
with check (public.has_role(array['admin','manager','engineer']::public.app_role[]));
create policy "scans_delete_admin_manager" on public.scans for delete to authenticated
using (public.has_role(array['admin','manager']::public.app_role[]));

create policy "modules_select" on public.modules for select to authenticated using (true);
create policy "modules_write_engineering_roles" on public.modules for all to authenticated
using (public.has_role(array['admin','manager','engineer']::public.app_role[]))
with check (public.has_role(array['admin','manager','engineer']::public.app_role[]));

create policy "metrics_select" on public.metrics for select to authenticated using (true);
create policy "metrics_write_engineering_roles" on public.metrics for all to authenticated
using (public.has_role(array['admin','manager','engineer']::public.app_role[]))
with check (public.has_role(array['admin','manager','engineer']::public.app_role[]));

create policy "metric_weights_read" on public.metric_weights for select to authenticated using (true);
create policy "metric_weights_admin_write" on public.metric_weights for all to authenticated
using (public.has_role(array['admin']::public.app_role[]))
with check (public.has_role(array['admin']::public.app_role[]));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.scans to authenticated;
grant select, insert, update, delete on public.modules to authenticated;
grant select, insert, update, delete on public.metrics to authenticated;
grant select, insert, update, delete on public.metric_weights to authenticated;
