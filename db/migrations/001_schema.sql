-- VMS Release 1 · QMS (NCF) to VMS · PostgreSQL 15+
-- Every table: id bigint identity PK. Ids stay internal; outside users see ncf_no, ref_no or a token hash.

-- ===== Master data =====
create table business_unit (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  name        text not null
);

create table app_user (
  id          bigint generated always as identity primary key,
  name        text not null,
  position    text,
  email       text not null unique,
  sso_id      text unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table user_role (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references app_user,
  role        text not null check (role in ('QC_INSPECTOR','NCF_APPROVER','PURCHASING','PCH_DIV_HEAD','AUDITOR','SUPER_ADMIN')),
  bu_id       bigint references business_unit,          -- null = all Business Units
  valid_to    date                                      -- end date, e.g. external auditor
);
create unique index user_role_uq on user_role (user_id, role, coalesce(bu_id, 0));

create table supplier (
  id              bigint generated always as identity primary key,
  sap_vendor_code text not null unique,
  name            text not null,
  status          text not null default 'ACTIVE'
                  check (status in ('PROSPECT','SURVEYED','APPROVED','ACTIVE','WARNED','BLOCKED','REMOVED'))
);

create table supplier_contact (
  id               bigint generated always as identity primary key,
  supplier_id      bigint not null references supplier,
  name             text not null,
  email            text,                                 -- may be empty: Purchasing is notified instead
  phone            text,
  is_ncf_recipient boolean not null default true,
  active           boolean not null default true
);
create index supplier_contact_supplier_ix on supplier_contact (supplier_id) where active;

create table item (
  id                bigint generated always as identity primary key,
  sap_material_code text not null unique,
  description       text not null,
  uom               text not null
);

create table approval_chain_step (
  id             bigint generated always as identity primary key,
  bu_id          bigint not null references business_unit,
  step_no        smallint not null check (step_no between 1 and 3),
  approver_title text not null,                          -- QC Manager, Material WHS Manager, GM
  approver_id    bigint references app_user,             -- optional named person
  unique (bu_id, step_no)
);

create table problem_category (
  id      bigint generated always as identity primary key,
  name    text not null unique,
  active  boolean not null default true
);

create table calendar_day (
  day         date primary key,
  is_working  boolean not null,
  name        text
);

create table setting (                                  -- reminder_window_wd, reminder_max, token_valid_days, file_limits
  key         text not null,
  valid_from  timestamptz not null default now(),
  value       jsonb not null,
  changed_by  bigint not null references app_user,
  primary key (key, valid_from)
);

-- ===== Platform: files =====
create table file_object (
  id           bigint generated always as identity primary key,
  file_name    text not null,
  mime         text not null,
  bytes        bigint not null check (bytes > 0),
  storage_key  text not null unique,                     -- content lives in object storage
  sha256       char(64) not null unique,
  created_at   timestamptz not null default now()
);

-- ===== SAP source (copied by the sync, read-only for users) =====
create table purchase_order (
  id           bigint generated always as identity primary key,
  po_no        text not null unique,
  supplier_id  bigint not null references supplier,
  po_date      date not null,
  currency     char(3) not null,
  synced_at    timestamptz not null
);
create index purchase_order_supplier_ix on purchase_order (supplier_id);

create table po_line (
  id                      bigint generated always as identity primary key,
  po_id                   bigint not null references purchase_order,
  line_no                 int not null,
  item_id                 bigint not null references item,
  qty                     numeric(18,3) not null,
  net_price               numeric(18,4) not null,
  price_unit              numeric(18,3) not null default 1,
  original_requested_date date not null,                 -- never overwritten (K-11)
  current_delivery_date   date not null,
  unique (po_id, line_no)
);
create index po_line_item_ix on po_line (item_id);

create table mrreg (
  id            bigint generated always as identity primary key,
  mrreg_no      text not null unique,
  bu_id         bigint not null references business_unit,
  supplier_id   bigint not null references supplier,
  sj_no         text not null,
  sj_date       date,
  receipt_date  date not null,                           -- Tanggal Masuk
  synced_at     timestamptz not null
);
create index mrreg_supplier_date_ix on mrreg (supplier_id, receipt_date);
create index mrreg_bu_ix on mrreg (bu_id);
create index mrreg_sj_ix on mrreg (sj_no);

create table mrreg_line (
  id            bigint generated always as identity primary key,
  mrreg_id      bigint not null references mrreg,
  line_no       int not null,
  po_line_id    bigint not null references po_line,
  item_id       bigint not null references item,
  qty_received  numeric(18,3) not null,
  uom           text not null,
  unique (mrreg_id, line_no)
);
create index mrreg_line_po_line_ix on mrreg_line (po_line_id);
create index mrreg_line_item_ix on mrreg_line (item_id);

-- ===== QMS · NCF =====
create table ncf (
  id                  bigint generated always as identity primary key,
  ncf_no              text not null unique,
  bu_id               bigint not null references business_unit,
  supplier_id         bigint not null references supplier,
  mrreg_id            bigint references mrreg,           -- null while Unmatched
  status              text not null default 'DRAFT'
                      check (status in ('DRAFT','WAITING_APPROVAL','APPROVED','SENT','RESPONDED','CLOSED','VOID')),
  current_version     smallint not null default 0,
  sj_no               text,                              -- frozen at submit
  sj_date             date,
  receipt_date        date,
  inspect_date        date not null,
  inspect_time        time not null,
  goods_status        text check (goods_status in ('HOLD','FAILED','OTHER')),
  hold_note           text,
  problem_category_id bigint references problem_category,
  problem_desc        text check (char_length(problem_desc) between 10 and 2000),
  follow_up           text,
  approved_at         timestamptz,
  closed_at           timestamptz,
  closed_by           bigint references app_user,
  closure_note        text,
  void_reason         text,
  created_at          timestamptz not null default now(),
  created_by          bigint not null references app_user,
  check (status <> 'VOID' or void_reason is not null),
  check (status <> 'CLOSED' or (closed_at is not null and closure_note is not null))
);
create index ncf_supplier_date_ix on ncf (supplier_id, receipt_date);      -- Quality per period
create index ncf_open_ix on ncf (status) where status not in ('CLOSED','VOID');
create index ncf_mrreg_ix on ncf (mrreg_id);
create index ncf_bu_ix on ncf (bu_id);
create index ncf_category_ix on ncf (problem_category_id);

create table ncf_item (
  id             bigint generated always as identity primary key,
  ncf_id         bigint not null references ncf,
  mrreg_line_id  bigint references mrreg_line,            -- null while Unmatched
  item_id        bigint not null references item,
  qty_received   numeric(18,3) not null,
  qty_sample     numeric(18,3) not null,
  qty_defect     numeric(18,3) not null,
  qty_return     numeric(18,3) not null default 0,
  unique (ncf_id, mrreg_line_id),
  check (qty_sample > 0 and qty_sample <= qty_received),
  check (qty_defect >= 1 and qty_defect <= qty_sample),
  check (qty_return between 0 and qty_received)
);
create index ncf_item_mrreg_line_ix on ncf_item (mrreg_line_id);
create index ncf_item_item_ix on ncf_item (item_id);

create table ncf_version (
  id            bigint generated always as identity primary key,
  ncf_id        bigint not null references ncf,
  version_no    smallint not null,
  content_hash  char(64) not null,                       -- SHA-256 of Part 1 and evidence list
  snapshot      jsonb not null,
  submitted_by  bigint not null references app_user,
  submitted_at  timestamptz not null default now(),
  unique (ncf_id, version_no)
);

create table ncf_approval (                               -- the electronic signature
  id               bigint generated always as identity primary key,
  ncf_version_id   bigint not null references ncf_version,
  step_no          smallint not null check (step_no between 0 and 3),   -- 0 = QC Inspector
  approver_id      bigint not null references app_user,
  signer_name      text not null,                          -- copied at signing
  signer_position  text not null,
  decision         text check (decision in ('APPROVED','RETURNED','REJECTED')),
  comment          text,
  decided_at       timestamptz,
  auth_method      text,                                   -- PASSWORD, SSO
  qr_token_hash    char(64) unique,
  unique (ncf_version_id, step_no),
  check (decision is null or decided_at is not null),
  check (decision is distinct from 'REJECTED' or comment is not null)
);
create index ncf_approval_task_ix on ncf_approval (approver_id) where decision is null;

-- ===== VMS · Supplier Exchange =====
create table supplier_request (
  id                     bigint generated always as identity primary key,
  ref_no                 text not null unique,
  type                   text not null check (type in ('NCF','CAF','SCORECARD','SURVEY')),
  supplier_id            bigint not null references supplier,
  ncf_id                 bigint unique references ncf,      -- 1 NCF : 1 request
  supplier_score_id      bigint,                            -- FK added after Evaluation
  status                 text not null default 'READY'
                         check (status in ('READY','SENT','RESPONDED','CLOSED','VOID')),
  send_method            text check (send_method in ('EMAIL','LINK')),
  sent_by                bigint references app_user,
  sent_at                timestamptz,                       -- starts the response clock
  first_opened_at        timestamptz,
  responded_at           timestamptz,
  response_working_days  smallint,
  closed_at              timestamptz,
  check (type <> 'NCF' or ncf_id is not null),
  check (sent_at is null or (sent_by is not null and send_method is not null))
);
create index supplier_request_supplier_sent_ix on supplier_request (supplier_id, sent_at);  -- Responsiveness
create index supplier_request_reminder_ix on supplier_request (sent_at) where status = 'SENT';
create index supplier_request_score_ix on supplier_request (supplier_score_id);

create table access_token (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references supplier_request,
  token_hash  char(64) not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index access_token_request_ix on access_token (request_id);

create table reminder (
  id             bigint generated always as identity primary key,
  request_id     bigint not null references supplier_request,
  seq_no         smallint not null,                       -- capped by setting reminder_max
  sent_at        timestamptz not null default now(),
  to_supplier    boolean not null,
  to_purchasing  boolean not null default true,
  unique (request_id, seq_no)
);

create table capa_response (
  id                  bigint generated always as identity primary key,
  request_id          bigint not null references supplier_request,
  root_cause          text not null,
  corrective_action   text not null,
  target_date         date not null,
  preventive_action   text not null,
  effective_from      date not null,
  responder_name      text not null,
  responder_position  text not null,
  responder_email     text not null,
  is_addendum         boolean not null default false,
  submitted_at        timestamptz not null default now(),
  ip                  inet,
  user_agent          text
);
create unique index capa_response_first_ix on capa_response (request_id) where not is_addendum;
create index capa_response_request_ix on capa_response (request_id);

-- ===== QMS · evidence (NCF photos or supplier CAPA files) =====
create table evidence (
  id                bigint generated always as identity primary key,
  ncf_id            bigint references ncf,
  capa_response_id  bigint references capa_response,
  file_id           bigint references file_object,
  kind              text not null check (kind in ('PHOTO','VIDEO','DOC','NOTE')),
  caption           text,
  uploaded_by       bigint references app_user,             -- null for supplier uploads
  uploaded_at       timestamptz not null default now(),
  check (num_nonnulls(ncf_id, capa_response_id) = 1),
  check (kind = 'NOTE' or file_id is not null)
);
create index evidence_ncf_ix on evidence (ncf_id);
create index evidence_capa_ix on evidence (capa_response_id);
create index evidence_file_ix on evidence (file_id);

-- ===== VMS · Supplier evaluation =====
create table period (
  id          bigint generated always as identity primary key,
  code        text not null unique,                        -- 2027-H1
  start_date  date not null,
  end_date    date not null,
  status      text not null default 'OPEN' check (status in ('OPEN','CALCULATED','SUBMITTED','LOCKED')),
  check (end_date > start_date)
);

create table parameter_set (
  id           bigint generated always as identity primary key,
  valid_from   date not null unique,
  weights      jsonb not null,
  ladders      jsonb not null,
  grade_bands  jsonb not null,
  switches     jsonb not null
);

create table score_run (
  id                bigint generated always as identity primary key,
  period_id         bigint not null references period,
  parameter_set_id  bigint not null references parameter_set,
  run_at            timestamptz not null default now(),
  is_final          boolean not null default false,
  is_backtest       boolean not null default false
);
create unique index score_run_final_ix on score_run (period_id) where is_final;
create index score_run_parameter_ix on score_run (parameter_set_id);

create table supplier_score (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references score_run,
  supplier_id  bigint not null references supplier,
  s_delivery   numeric(5,4),
  s_quality    numeric(5,4),
  s_price      numeric(5,4),
  s_response   numeric(5,4),
  total        numeric(5,4) not null,
  grade        char(1) not null check (grade in ('A','B','C','D','E')),
  vm_note      text,
  unique (run_id, supplier_id)
);
create index supplier_score_supplier_ix on supplier_score (supplier_id);

create table score_evidence (
  id                 bigint generated always as identity primary key,
  supplier_score_id  bigint not null references supplier_score,
  category           text not null check (category in ('DEL','QUAL','PRICE','RESP')),
  mrreg_line_id      bigint references mrreg_line,
  po_line_id         bigint references po_line,
  ncf_id             bigint references ncf,
  request_id         bigint references supplier_request,
  "values"           jsonb not null,
  check (num_nonnulls(mrreg_line_id, po_line_id, ncf_id, request_id) = 1)
);
create index score_evidence_score_ix on score_evidence (supplier_score_id, category);
create index score_evidence_mrreg_line_ix on score_evidence (mrreg_line_id);
create index score_evidence_po_line_ix on score_evidence (po_line_id);
create index score_evidence_ncf_ix on score_evidence (ncf_id);
create index score_evidence_request_ix on score_evidence (request_id);

alter table supplier_request
  add constraint supplier_request_score_fk foreign key (supplier_score_id) references supplier_score,
  add constraint supplier_request_score_ck check (type not in ('CAF','SCORECARD') or supplier_score_id is not null);

-- ===== Platform: logs and outbox =====
create table audit_log (
  id          bigint generated always as identity,
  at          timestamptz not null default now(),
  entity      text not null,
  entity_id   bigint not null,
  action      text not null,
  field       text,
  old_value   text,
  new_value   text,
  actor_type  text not null check (actor_type in ('USER','SUPPLIER','SYSTEM')),
  actor_id    bigint,
  primary key (id, at)
) partition by range (at);
create index audit_log_entity_ix on audit_log (entity, entity_id, at);

create table qr_scan (
  id               bigint generated always as identity,
  at               timestamptz not null default now(),
  qr_type          text not null check (qr_type in ('DOCUMENT','SIGNATURE')),
  ncf_version_id   bigint references ncf_version,
  ncf_approval_id  bigint references ncf_approval,
  user_id          bigint references app_user,             -- null when not logged in
  ip               inet,
  primary key (id, at),
  check (num_nonnulls(ncf_version_id, ncf_approval_id) = 1)
) partition by range (at);

create table print_log (
  id              bigint generated always as identity primary key,
  ncf_version_id  bigint not null references ncf_version,
  kind            text not null check (kind in ('COPY','DRAFT','VOID')),
  printed_by      bigint not null references app_user,
  printed_at      timestamptz not null default now()
);
create index print_log_version_ix on print_log (ncf_version_id);

create table notification_outbox (
  id                 bigint generated always as identity primary key,
  event              text not null,                        -- NCF_SUBMITTED, NCF_SENT, REMINDER, ...
  ref_table          text,
  ref_id             bigint,
  recipient_email    text,
  recipient_user_id  bigint references app_user,
  template           text not null,
  payload            jsonb not null,
  status             text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','BOUNCED')),
  attempts           smallint not null default 0,
  next_try_at        timestamptz not null default now(),
  sent_at            timestamptz,
  error              text,
  check (recipient_email is not null or recipient_user_id is not null)
);
create index notification_outbox_due_ix on notification_outbox (next_try_at) where status = 'PENDING';

-- ===== Indexes on the remaining foreign keys (who-did-it columns, QR scans) =====
create index user_role_bu_ix on user_role (bu_id);
create index approval_chain_step_user_ix on approval_chain_step (approver_id);
create index setting_changed_by_ix on setting (changed_by);
create index ncf_closed_by_ix on ncf (closed_by);
create index ncf_created_by_ix on ncf (created_by);
create index ncf_version_submitted_by_ix on ncf_version (submitted_by);
create index supplier_request_sent_by_ix on supplier_request (sent_by);
create index evidence_uploaded_by_ix on evidence (uploaded_by);
create index qr_scan_version_ix on qr_scan (ncf_version_id);
create index qr_scan_approval_ix on qr_scan (ncf_approval_id);
create index qr_scan_user_ix on qr_scan (user_id);
create index print_log_user_ix on print_log (printed_by);
create index notification_outbox_user_ix on notification_outbox (recipient_user_id);
