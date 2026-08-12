-- Sales month lock: months with filed GSTR-1 cannot edit sale invoices.
alter table public.firms
  add column if not exists locked_sales_months jsonb default '[]'::jsonb;
