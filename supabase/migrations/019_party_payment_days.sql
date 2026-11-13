-- Per-party credit / payment due days (injected into invoice Terms & Conditions).

alter table parties
  add column if not exists payment_days integer;

comment on column parties.payment_days is 'Invoice payment due days for this party (Terms clause 1)';
