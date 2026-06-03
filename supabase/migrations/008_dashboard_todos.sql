-- Run after 007_secure_org_members_insert.sql
-- Dashboard to-do items. Payload-backed like purchases, vouchers,
-- and item stock movements so they sync across devices.

create table if not exists dashboard_todos (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table dashboard_todos enable row level security;

create policy "dashboard_todos_org" on dashboard_todos
  for all using (org_id in (select user_org_ids()));

create index if not exists idx_dashboard_todos_org on dashboard_todos(org_id);
create index if not exists idx_dashboard_todos_firm on dashboard_todos(firm_id);
create index if not exists idx_dashboard_todos_updated on dashboard_todos(updated_at);
create index if not exists idx_dashboard_todos_payload_completed
  on dashboard_todos((payload->>'completed'));

alter publication supabase_realtime add table dashboard_todos;
