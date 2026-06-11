-- Redundant online backup for payroll (staff, advances, monthly runs + attendance).
-- Run in Supabase SQL Editor after 011_payroll.sql.

alter table public.org_settings
  add column if not exists payroll_backup jsonb not null default '{}'::jsonb;
