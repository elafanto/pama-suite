-- Run after 004_inventory_and_firm_sync_fields.sql
-- Production/reel stock tables are payload-backed like purchases and vouchers.

create table if not exists reel_stocks (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists production_jobs (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists production_stages (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists stock_movements (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table reel_stocks enable row level security;
alter table production_jobs enable row level security;
alter table production_stages enable row level security;
alter table stock_movements enable row level security;

create policy "reel_stocks_org" on reel_stocks for all using (org_id in (select user_org_ids()));
create policy "production_jobs_org" on production_jobs for all using (org_id in (select user_org_ids()));
create policy "production_stages_org" on production_stages for all using (org_id in (select user_org_ids()));
create policy "stock_movements_org" on stock_movements for all using (org_id in (select user_org_ids()));

create index if not exists idx_reel_stocks_firm on reel_stocks(firm_id);
create index if not exists idx_production_jobs_firm on production_jobs(firm_id);
create index if not exists idx_production_stages_firm on production_stages(firm_id);
create index if not exists idx_stock_movements_firm on stock_movements(firm_id);

alter publication supabase_realtime add table reel_stocks;
alter publication supabase_realtime add table production_jobs;
alter publication supabase_realtime add table production_stages;
alter publication supabase_realtime add table stock_movements;
