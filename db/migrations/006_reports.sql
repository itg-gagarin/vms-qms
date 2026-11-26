-- Working days from one moment to another (WIB dates), as the app counts supplier response time:
-- days after the start date, up to and including the end date, that are working days in calendar_day.
create or replace function working_days_between(a timestamptz, b timestamptz) returns int
language sql stable as $$
  select count(*)::int from calendar_day
  where is_working
    and day > (a at time zone 'Asia/Jakarta')::date
    and day <= (b at time zone 'Asia/Jakarta')::date
$$;
