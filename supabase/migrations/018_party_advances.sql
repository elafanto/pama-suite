-- Party advances (customer receipts / vendor payments before bill).

create table if not exists party_advances (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table party_advances enable row level security;

create policy "party_advances_org" on party_advances for all using (org_id in (select user_org_ids()));

create index if not exists idx_party_advances_firm on party_advances(firm_id);

alter publication supabase_realtime add table party_advances;
