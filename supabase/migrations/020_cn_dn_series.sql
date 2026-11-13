-- Separate Credit Note / Debit Note number series on firms.

alter table firms
  add column if not exists cn_prefix text,
  add column if not exists next_cn_no integer,
  add column if not exists dn_prefix text,
  add column if not exists next_dn_no integer;

update firms
set
  cn_prefix = coalesce(nullif(trim(cn_prefix), ''), 'CN'),
  next_cn_no = coalesce(next_cn_no, 1),
  dn_prefix = coalesce(nullif(trim(dn_prefix), ''), 'DN'),
  next_dn_no = coalesce(next_dn_no, 1)
where true;

comment on column firms.cn_prefix is 'Credit note number prefix (default CN)';
comment on column firms.next_cn_no is 'Next credit note sequence number';
comment on column firms.dn_prefix is 'Debit note number prefix (default DN)';
comment on column firms.next_dn_no is 'Next debit note sequence number';
