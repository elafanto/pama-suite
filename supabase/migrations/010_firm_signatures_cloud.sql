-- Online backup for firm signatures (org-wide, survives device loss).
-- Run in Supabase SQL Editor after 009_document_attachments.sql.

alter table public.org_settings
  add column if not exists firm_signatures jsonb not null default '{}'::jsonb;

alter table public.org_settings
  add column if not exists signature_archive jsonb not null default '{}'::jsonb;
