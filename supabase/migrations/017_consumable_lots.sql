-- Consumable lots (gum / ink / stitching wire / strapping) — pack size × bags, no numbering.
-- Payload-backed like reel_stocks.

create table if not exists consumable_lots (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table consumable_lots enable row level security;

create policy "consumable_lots_org" on consumable_lots for all using (org_id in (select user_org_ids()));

create index if not exists idx_consumable_lots_firm on consumable_lots(firm_id);

alter publication supabase_realtime add table consumable_lots;
