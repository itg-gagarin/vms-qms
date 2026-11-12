-- MVP additions on top of the FD schema (001_schema.sql)

-- Login for the MVP. SSO can replace this later; sso_id already exists.
alter table app_user add column password_hash text;

-- Running number per year for No. Komplain (format NNN/ROMAN-MONTH/YYYY, as on the paper form)
create table doc_counter (
  key   text primary key,          -- e.g. NCF-2026
  last  int  not null
);

-- QR codes need a stable public code that can be printed again later.
-- The code only opens a read-only verification page, so it is stored as is.
alter table ncf_version  add column verify_code text unique;
alter table ncf_approval drop column qr_token_hash;
alter table ncf_approval add column verify_code text unique;

-- Default partitions so the partitioned logs accept rows before monthly partitions exist.
create table audit_log_default partition of audit_log default;
create table qr_scan_default   partition of qr_scan   default;
