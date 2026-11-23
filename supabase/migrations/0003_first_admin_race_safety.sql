-- Make first-admin bootstrap deterministic if two accounts sign up concurrently.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  initial_role public.app_role;
begin
  -- Serialize first-user checks so only one concurrent signup can be promoted to admin.
  perform pg_advisory_xact_lock(hashtext('softpulse-first-admin'));

  insert into public.profiles(id, email, display_name)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'display_name',''));

  if not exists (select 1 from public.user_roles) then
    initial_role := 'admin';
  else
    initial_role := 'viewer';
  end if;

  insert into public.user_roles(user_id, role) values (new.id, initial_role);
  return new;
end;
$$;
