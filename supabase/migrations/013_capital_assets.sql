-- Capital assets register (machinery, furniture, etc.) — separate from consumable inventory.

create table if not exists public.capital_assets (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  name text not null,
  item_id uuid references public.items(id) on delete set null,
  category text not null default 'plant_machinery',
  asset_tag text,
  supplier_id uuid references public.parties(id) on delete set null,
  supplier_name text not null default '',
  purchase_id uuid references public.purchases(id) on delete set null,
  purchase_bill_no text not null default '',
  purchase_line_index integer not null default 0,
  purchase_date date,
  qty numeric not null default 1,
  unit text not null default 'NOS',
  rate numeric not null default 0,
  amount numeric not null default 0,
  hsn text,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists capital_assets_firm_purchase_idx on public.capital_assets (firm_id, purchase_id);
create index if not exists capital_assets_firm_category_idx on public.capital_assets (firm_id, category);
create index if not exists capital_assets_firm_status_idx on public.capital_assets (firm_id, status);

alter table public.capital_assets enable row level security;
