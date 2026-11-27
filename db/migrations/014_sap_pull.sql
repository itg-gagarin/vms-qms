-- SAP feed, pull: the platform calls the n8n webhook (SAP_FEED_URL) on a schedule or on "Sync now".
-- Each batch records where it came from and who asked for it; a lease stops two servers from running a job at once.
alter table sap_import_batch add column origin text not null default 'push' check (origin in ('push', 'pull'));
alter table sap_import_batch add column triggered_by bigint references app_user;  -- "Sync now"; null = schedule or n8n

create table job_lease (
  name        text primary key,
  held_until  timestamptz not null,
  last_run_at timestamptz
);
