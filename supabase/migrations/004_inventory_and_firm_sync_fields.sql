alter table public.firms add column if not exists signature text;

alter table public.items add column if not exists track_stock boolean default true;
alter table public.items add column if not exists opening_stock numeric default 0;
alter table public.items add column if not exists reorder_level numeric default 0;
alter table public.items add column if not exists purchase_rate numeric default 0;
