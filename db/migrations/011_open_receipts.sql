-- SAP Goods Receipt lists only receipts that can still get an NCF: none raised yet (a void one does not count)
-- and not cancelled in SAP. A flag kept by a trigger, plus a partial index over exactly those rows, so the list
-- reads one index instead of checking the NCFs of every receipt.
alter table mrreg add column has_live_ncf boolean not null default false;

update mrreg m set has_live_ncf = exists (select 1 from ncf x where x.mrreg_id = m.id and x.status <> 'VOID');

create function mrreg_refresh_live_ncf(p_mrreg bigint) returns void language sql as $$
  update mrreg m set has_live_ncf = exists (select 1 from ncf x where x.mrreg_id = m.id and x.status <> 'VOID')
  where m.id = p_mrreg;
$$;

create function ncf_sync_mrreg_flag() returns trigger language plpgsql as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.mrreg_id is not null then
    perform mrreg_refresh_live_ncf(new.mrreg_id);
  end if;
  if tg_op = 'DELETE' and old.mrreg_id is not null then
    perform mrreg_refresh_live_ncf(old.mrreg_id);
  elsif tg_op = 'UPDATE' and old.mrreg_id is not null and old.mrreg_id is distinct from new.mrreg_id then
    perform mrreg_refresh_live_ncf(old.mrreg_id);
  end if;
  return null;
end $$;

create trigger ncf_sync_mrreg_flag after insert or delete or update of status, mrreg_id on ncf
  for each row execute function ncf_sync_mrreg_flag();

create index mrreg_open_receipts_ix on mrreg (receipt_date desc, id desc)
  where not has_live_ncf and sap_status is distinct from 'CANCELED';
