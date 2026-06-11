-- Payroll Phase 1: staff master, advances, monthly salary runs.
-- Run in Supabase SQL Editor after 010_firm_signatures_cloud.sql.

create table if not exists staff (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists staff_advances (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists payroll_runs (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table staff enable row level security;
alter table staff_advances enable row level security;
alter table payroll_runs enable row level security;

create policy "staff_org" on staff
  for all using (org_id in (select user_org_ids()));

create policy "staff_advances_org" on staff_advances
  for all using (org_id in (select user_org_ids()));

create policy "payroll_runs_org" on payroll_runs
  for all using (org_id in (select user_org_ids()));

create index if not exists idx_staff_org on staff(org_id);
create index if not exists idx_staff_firm on staff(firm_id);
create index if not exists idx_staff_updated on staff(updated_at);

create index if not exists idx_staff_advances_org on staff_advances(org_id);
create index if not exists idx_staff_advances_firm on staff_advances(firm_id);
create index if not exists idx_staff_advances_updated on staff_advances(updated_at);

create index if not exists idx_payroll_runs_org on payroll_runs(org_id);
create index if not exists idx_payroll_runs_firm on payroll_runs(firm_id);
create index if not exists idx_payroll_runs_updated on payroll_runs(updated_at);
create index if not exists idx_payroll_runs_period on payroll_runs((payload->>'period'));

alter publication supabase_realtime add table staff;
alter publication supabase_realtime add table staff_advances;
alter publication supabase_realtime add table payroll_runs;
