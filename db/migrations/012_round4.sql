-- Round 4: Indonesian public holidays as calendar defaults, job positions, in-app notifications, API keys.

-- 1. Working calendar: Indonesian national holidays and cuti bersama for 2026 and 2027, from the SKB 3 Menteri
--    as published on setneg.go.id (2026: 17 + 8 days; 2027: 18 + 8 days). Cuti bersama are holidays by default;
--    a company that works on them removes the day in Master Settings, Working calendar. Days an admin already
--    named are left as they are.
alter table calendar_day add column kind text check (kind in ('NATIONAL','CUTI_BERSAMA','COMPANY'));

insert into calendar_day(day, is_working)
select d::date, extract(isodow from d) < 6 from generate_series('2026-01-01'::date, '2027-12-31'::date, interval '1 day') d
on conflict (day) do nothing;

with h(day, name, kind) as (values
  ('2026-01-01', 'Tahun Baru 2026 Masehi', 'NATIONAL'),
  ('2026-01-16', 'Isra Mikraj Nabi Muhammad saw.', 'NATIONAL'),
  ('2026-02-17', 'Tahun Baru Imlek 2577 Kongzili', 'NATIONAL'),
  ('2026-03-19', 'Hari Suci Nyepi (Tahun Baru Saka 1948)', 'NATIONAL'),
  ('2026-03-21', 'Idulfitri 1447 H', 'NATIONAL'),
  ('2026-03-22', 'Idulfitri 1447 H', 'NATIONAL'),
  ('2026-04-03', 'Wafat Yesus Kristus', 'NATIONAL'),
  ('2026-04-05', 'Kebangkitan Yesus Kristus (Paskah)', 'NATIONAL'),
  ('2026-05-01', 'Hari Buruh Internasional', 'NATIONAL'),
  ('2026-05-14', 'Kenaikan Yesus Kristus', 'NATIONAL'),
  ('2026-05-27', 'Iduladha 1447 H', 'NATIONAL'),
  ('2026-05-31', 'Hari Raya Waisak 2570 BE', 'NATIONAL'),
  ('2026-06-01', 'Hari Lahir Pancasila', 'NATIONAL'),
  ('2026-06-16', '1 Muharam Tahun Baru Islam 1448 H', 'NATIONAL'),
  ('2026-08-17', 'Proklamasi Kemerdekaan', 'NATIONAL'),
  ('2026-08-25', 'Maulid Nabi Muhammad saw.', 'NATIONAL'),
  ('2026-12-25', 'Kelahiran Yesus Kristus', 'NATIONAL'),
  ('2027-01-01', 'Tahun Baru 2027 Masehi', 'NATIONAL'),
  ('2027-01-05', 'Isra Mikraj Nabi Muhammad saw.', 'NATIONAL'),
  ('2027-02-06', 'Tahun Baru Imlek 2578 Kongzili', 'NATIONAL'),
  ('2027-03-08', 'Hari Suci Nyepi (Tahun Baru Saka 1949)', 'NATIONAL'),
  ('2027-03-10', 'Idulfitri 1448 Hijriah', 'NATIONAL'),
  ('2027-03-11', 'Idulfitri 1448 Hijriah', 'NATIONAL'),
  ('2027-03-26', 'Wafat Yesus Kristus', 'NATIONAL'),
  ('2027-03-28', 'Hari Kebangkitan Yesus Kristus (Paskah)', 'NATIONAL'),
  ('2027-05-01', 'Hari Buruh Internasional', 'NATIONAL'),
  ('2027-05-06', 'Kenaikan Yesus Kristus', 'NATIONAL'),
  ('2027-05-17', 'Iduladha 1448 Hijriah', 'NATIONAL'),
  ('2027-05-20', 'Hari Raya Waisak 2571 BE', 'NATIONAL'),
  ('2027-06-01', 'Hari Lahir Pancasila', 'NATIONAL'),
  ('2027-06-06', '1 Muharam Tahun Baru Islam 1449 Hijriah', 'NATIONAL'),
  ('2027-08-15', 'Maulid Nabi Muhammad SAW', 'NATIONAL'),
  ('2027-08-17', 'Proklamasi Kemerdekaan', 'NATIONAL'),
  ('2027-12-25', 'Kelahiran Yesus Kristus (Natal)', 'NATIONAL'),
  ('2027-12-26', 'Isra Mikraj Nabi Muhammad saw.', 'NATIONAL'),
  ('2026-02-16', 'Cuti bersama · Tahun Baru Imlek 2577 Kongzili', 'CUTI_BERSAMA'),
  ('2026-03-18', 'Cuti bersama · Hari Suci Nyepi (Tahun Baru Saka 1948)', 'CUTI_BERSAMA'),
  ('2026-03-20', 'Cuti bersama · Idulfitri 1447 H', 'CUTI_BERSAMA'),
  ('2026-03-23', 'Cuti bersama · Idulfitri 1447 H', 'CUTI_BERSAMA'),
  ('2026-03-24', 'Cuti bersama · Idulfitri 1447 H', 'CUTI_BERSAMA'),
  ('2026-05-15', 'Cuti bersama · Kenaikan Yesus Kristus', 'CUTI_BERSAMA'),
  ('2026-05-28', 'Cuti bersama · Iduladha 1447 H', 'CUTI_BERSAMA'),
  ('2026-12-24', 'Cuti bersama · Kelahiran Yesus Kristus', 'CUTI_BERSAMA'),
  ('2027-02-05', 'Cuti bersama · Tahun Baru Imlek 2578 Kongzili', 'CUTI_BERSAMA'),
  ('2027-03-09', 'Cuti bersama · Hari Raya Idulfitri 1448 Hijriah', 'CUTI_BERSAMA'),
  ('2027-03-12', 'Cuti bersama · Hari Raya Idulfitri 1448 Hijriah', 'CUTI_BERSAMA'),
  ('2027-03-15', 'Cuti bersama · Hari Raya Idulfitri 1448 Hijriah', 'CUTI_BERSAMA'),
  ('2027-03-25', 'Cuti bersama · Wafat Yesus Kristus', 'CUTI_BERSAMA'),
  ('2027-05-18', 'Cuti bersama · Iduladha 1448 H', 'CUTI_BERSAMA'),
  ('2027-05-19', 'Cuti bersama · Waisak 2571 BE', 'CUTI_BERSAMA'),
  ('2027-12-24', 'Cuti bersama · Kelahiran Yesus Kristus (Natal)', 'CUTI_BERSAMA')
)
update calendar_day c set is_working = false, name = h.name, kind = h.kind
from h where c.day = h.day::date and c.name is null;

update calendar_day set kind = 'COMPANY' where not is_working and name is not null and kind is null;

-- 2. Job positions: the list behind the Position dropdown. app_user.position keeps the text printed under
--    signatures, so renaming a position never rewrites a signed record.
create table job_position (
  id     bigint generated always as identity primary key,
  name   text not null unique,
  active boolean not null default true
);
insert into job_position(name)
select distinct position from app_user where position is not null and position <> ''
union select unnest(array['QC Incoming','QC Manager','Material WHS Manager','General Manager','Purchasing','PCH Div. Head','Compliance','PMO'])
on conflict (name) do nothing;

-- 3. In-app notifications: the internal messages already queued in notification_outbox, with a read mark.
alter table notification_outbox add column read_at timestamptz;
alter table notification_outbox add column created_at timestamptz not null default now();
create index notification_inbox_ix on notification_outbox (recipient_user_id, id desc) where recipient_user_id is not null;

-- 4. API keys for systems that read NCF data (the VMS). Only a hash is stored; the key is shown once.
create table api_key (
  id           bigint generated always as identity primary key,
  name         text not null,
  prefix       text not null unique,
  key_hash     text not null,
  created_by   bigint not null references app_user,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
