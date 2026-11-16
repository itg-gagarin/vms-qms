-- Closing no longer asks for a verification note: the supplier's reply is kept as received, and the close itself
-- (who, when) is the record. 001 named the old check implicitly, so find it by its definition.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'ncf'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%closure_note IS NOT NULL%'
  loop
    execute format('alter table ncf drop constraint %I', c);
  end loop;
end $$;

alter table ncf add constraint ncf_closed_complete check (status <> 'CLOSED' or (closed_at is not null and closed_by is not null));
