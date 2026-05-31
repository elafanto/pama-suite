-- Run after 002_realtime_and_org_bootstrap.sql
-- Reliable first-login org creation (fixes "Organization not ready yet")

create or replace function public.bootstrap_user_org(display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  oid uuid;
  dn text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select org_id into oid from profiles where id = uid;
  if oid is not null then
    return oid;
  end if;

  select coalesce(
    nullif(trim(display_name), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'User'
  )
  into dn
  from auth.users u
  where u.id = uid;

  insert into orgs (name) values ('Pama Packaging') returning id into oid;
  insert into org_members (org_id, user_id, role) values (oid, uid, 'owner');
  insert into profiles (id, org_id, display_name)
  values (uid, oid, dn)
  on conflict (id) do update set org_id = excluded.org_id, display_name = excluded.display_name;

  return oid;
end;
$$;

revoke all on function public.bootstrap_user_org(text) from public;
grant execute on function public.bootstrap_user_org(text) to authenticated;

-- Profiles: allow read/write own row on first login
drop policy if exists "profiles_self" on profiles;
create policy "profiles_select" on profiles for select using (id = auth.uid());
create policy "profiles_insert" on profiles for insert with check (id = auth.uid());
create policy "profiles_update" on profiles for update using (id = auth.uid());
