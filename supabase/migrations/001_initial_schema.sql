-- Pama Business Suite — initial schema (run in Supabase SQL Editor)
-- Enable RLS on all tables; users belong to orgs via org_members

create extension if not exists "pgcrypto";

-- ── Orgs & membership ─────────────────────────────────────────────────────
create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists org_members (
  org_id uuid references orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'owner',
  primary key (org_id, user_id)
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references orgs(id),
  display_name text,
  created_at timestamptz default now()
);

-- ── Core business tables (mirror Dexie + org scope) ─────────────────────────
create table if not exists firms (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  gst text, addr text, city text, state text, pin text,
  phone text, email text,
  bank_name text, bank_acno text, bank_ifsc text,
  logo text, prefix text, next_bill_no int default 1,
  decl text, terms text,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists parties (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  name text not null,
  roles text[] default '{}',
  gst text, phone text, email text, addr text, city text, pin text, state text,
  is_consumer boolean default false,
  bank text, acno text, ifsc text, acname text,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists items (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  name text not null, unit text, hsn text, gst numeric, rate numeric,
  size text, gsm text, bf text,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists invoices (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists purchases (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists recipes (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists accounts (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists vouchers (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists org_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  gemini_key text,
  rtgs_accounts jsonb,
  bank_email text,
  updated_at timestamptz default now()
);

-- ── RLS helpers ───────────────────────────────────────────────────────────
create or replace function user_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid()
$$;

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table profiles enable row level security;
alter table firms enable row level security;
alter table parties enable row level security;
alter table items enable row level security;
alter table invoices enable row level security;
alter table purchases enable row level security;
alter table recipes enable row level security;
alter table accounts enable row level security;
alter table vouchers enable row level security;
alter table org_settings enable row level security;

create policy "orgs_member" on orgs for all using (id in (select user_org_ids()));
create policy "members_self" on org_members for all using (user_id = auth.uid());
create policy "profiles_self" on profiles for all using (id = auth.uid());

create policy "firms_org" on firms for all using (org_id in (select user_org_ids()));
create policy "parties_org" on parties for all using (org_id in (select user_org_ids()));
create policy "items_org" on items for all using (org_id in (select user_org_ids()));
create policy "invoices_org" on invoices for all using (org_id in (select user_org_ids()));
create policy "purchases_org" on purchases for all using (org_id in (select user_org_ids()));
create policy "recipes_org" on recipes for all using (org_id in (select user_org_ids()));
create policy "accounts_org" on accounts for all using (org_id in (select user_org_ids()));
create policy "vouchers_org" on vouchers for all using (org_id in (select user_org_ids()));
create policy "settings_org" on org_settings for all using (org_id in (select user_org_ids()));

-- Indexes
create index if not exists idx_parties_firm on parties(firm_id);
create index if not exists idx_invoices_firm on invoices(firm_id);
create index if not exists idx_purchases_firm on purchases(firm_id);
