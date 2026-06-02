-- Run after 005_production_tracking.sql
-- Item-level stock ledger table. Payload-backed like purchases, vouchers,
-- and production stock movement tables.

create table if not exists item_stock_movements (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table item_stock_movements enable row level security;

create policy "item_stock_movements_org" on item_stock_movements
  for all using (org_id in (select user_org_ids()));

create index if not exists idx_item_stock_movements_org on item_stock_movements(org_id);
create index if not exists idx_item_stock_movements_firm on item_stock_movements(firm_id);
create index if not exists idx_item_stock_movements_updated on item_stock_movements(updated_at);
create index if not exists idx_item_stock_movements_payload_item
  on item_stock_movements((payload->>'item_id'));
create index if not exists idx_item_stock_movements_payload_date
  on item_stock_movements((payload->>'date'));

alter publication supabase_realtime add table item_stock_movements;
