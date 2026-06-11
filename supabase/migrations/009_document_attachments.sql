-- Document attachments metadata + Supabase Storage bucket for bill/voucher files.
-- Run in Supabase SQL Editor after migrations 001–008.

create table if not exists document_attachments (
  id text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  firm_id text not null,
  payload jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table document_attachments enable row level security;

drop policy if exists "document_attachments_org" on document_attachments;
create policy "document_attachments_org" on document_attachments
  for all using (org_id in (select user_org_ids()));

create index if not exists idx_document_attachments_firm on document_attachments(firm_id);
create index if not exists idx_document_attachments_updated on document_attachments(updated_at);

-- Private bucket for purchase bills, sales invoices, voucher scans (max 10 MB per file).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pama-documents',
  'pama-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pama_docs_select" on storage.objects;
drop policy if exists "pama_docs_insert" on storage.objects;
drop policy if exists "pama_docs_update" on storage.objects;
drop policy if exists "pama_docs_delete" on storage.objects;

create policy "pama_docs_select" on storage.objects for select
using (
  bucket_id = 'pama-documents'
  and (storage.foldername(name))[1] in (
    select org_id::text from org_members where user_id = auth.uid()
  )
);

create policy "pama_docs_insert" on storage.objects for insert
with check (
  bucket_id = 'pama-documents'
  and (storage.foldername(name))[1] in (
    select org_id::text from org_members where user_id = auth.uid()
  )
);

create policy "pama_docs_update" on storage.objects for update
using (
  bucket_id = 'pama-documents'
  and (storage.foldername(name))[1] in (
    select org_id::text from org_members where user_id = auth.uid()
  )
);

create policy "pama_docs_delete" on storage.objects for delete
using (
  bucket_id = 'pama-documents'
  and (storage.foldername(name))[1] in (
    select org_id::text from org_members where user_id = auth.uid()
  )
);
