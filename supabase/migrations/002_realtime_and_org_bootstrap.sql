-- Run after 001_initial_schema.sql
-- Fixes first-login org creation (RLS) + enables Realtime for multi-device sync

-- ── Fix org bootstrap (first sign-up must create org before membership exists) ──
drop policy if exists "orgs_member" on orgs;
create policy "orgs_select" on orgs for select using (id in (select user_org_ids()));
create policy "orgs_insert" on orgs for insert with check (auth.uid() is not null);
create policy "orgs_update" on orgs for update using (id in (select user_org_ids()));
create policy "orgs_delete" on orgs for delete using (id in (select user_org_ids()));

drop policy if exists "members_self" on org_members;
create policy "members_select" on org_members for select using (user_id = auth.uid());
create policy "members_insert" on org_members for insert with check (user_id = auth.uid());
create policy "members_update" on org_members for update using (user_id = auth.uid());
create policy "members_delete" on org_members for delete using (user_id = auth.uid());

-- ── Realtime (Supabase Dashboard → Database → Replication may also need toggles) ──
alter publication supabase_realtime add table firms;
alter publication supabase_realtime add table parties;
alter publication supabase_realtime add table items;
alter publication supabase_realtime add table invoices;
alter publication supabase_realtime add table purchases;
alter publication supabase_realtime add table recipes;
alter publication supabase_realtime add table accounts;
alter publication supabase_realtime add table vouchers;
