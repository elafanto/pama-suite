-- Run after 006_item_stock_movements.sql
-- Lock down org membership creation. Membership rows should be created only by
-- trusted bootstrap/invite flows such as public.bootstrap_user_org() or server-side
-- invite handlers running with elevated privileges.

drop policy if exists "members_self" on org_members;
drop policy if exists "members_select" on org_members;
drop policy if exists "members_insert" on org_members;
drop policy if exists "members_update" on org_members;
drop policy if exists "members_delete" on org_members;

create policy "members_select" on org_members
  for select
  using (user_id = auth.uid());

create policy "members_update" on org_members
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "members_delete" on org_members
  for delete
  using (user_id = auth.uid());

comment on table org_members is
  'Org membership rows are created by trusted bootstrap/invite flows; direct client inserts are blocked by RLS.';
