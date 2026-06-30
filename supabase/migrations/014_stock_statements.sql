create table if not exists public.stock_statements (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  statement_no text not null default '',
  statement_date date not null default current_date,
  bank_name text not null default '',
  branch_name text not null default '',
  remarks text not null default '',
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists stock_statements_firm_date_idx on public.stock_statements (firm_id, statement_date);
create index if not exists stock_statements_firm_no_idx on public.stock_statements (firm_id, statement_no);

alter table public.stock_statements enable row level security;
