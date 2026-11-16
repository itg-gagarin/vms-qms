-- Suppliers mostly answer by email. Purchasing records the reply ("Returned"): the received time stops the
-- response clock, the reply files are kept, and the CAPA is read from them automatically, then checked by Purchasing.

alter table capa_response
  add column received_via text not null default 'SUPPLIER_LINK' check (received_via in ('SUPPLIER_LINK', 'PURCHASING')),
  add column recorded_by bigint references app_user,
  add column extraction jsonb,                     -- what the automatic reading returned, kept unchanged for audit
  add column reviewed_at timestamptz,              -- Purchasing confirmed the CAPA against the reply
  add column reviewed_by bigint references app_user;

-- A reply recorded by Purchasing may start incomplete until it is checked; a supplier's own answer is always complete.
alter table capa_response
  alter column root_cause drop not null,
  alter column corrective_action drop not null,
  alter column target_date drop not null,
  alter column preventive_action drop not null,
  alter column effective_from drop not null,
  alter column responder_name drop not null,
  alter column responder_position drop not null,
  alter column responder_email drop not null;
alter table capa_response add constraint capa_link_complete check (
  received_via <> 'SUPPLIER_LINK' or (
    root_cause is not null and corrective_action is not null and target_date is not null and preventive_action is not null
    and effective_from is not null and responder_name is not null and responder_position is not null and responder_email is not null
  )
);
alter table capa_response add constraint capa_purchasing_recorder check (received_via <> 'PURCHASING' or recorded_by is not null);
create index capa_response_recorded_by_ix on capa_response (recorded_by);
create index capa_response_reviewed_by_ix on capa_response (reviewed_by);
