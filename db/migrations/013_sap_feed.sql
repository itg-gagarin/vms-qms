-- SAP feed: n8n runs the MRReg + PO query in SAP Business One (HANA) and posts the rows to POST /api/import/sap/mrreg.
-- Only additions: nullable columns for the fields the query carries, a table that keeps every row as received, a batch
-- log, the SAP branch of each Business Unit, and a scope on API keys so a read key (VMS) cannot write.

-- API keys: 'read' for /api/v1 (all existing keys), 'import' for the SAP feed. A key does one thing.
alter table api_key add column scope text not null default 'read' check (scope in ('read', 'import'));

-- Business Unit <- SAP branch (OPOR."BPLId"). Unmapped branches go to DEFAULT_BU_CODE and are reported.
alter table business_unit add column sap_branch_id int unique;

-- Receipt header (@ST_MRREG)
alter table mrreg add column sap_doc_entry      int;          -- "MRReg Entry" (DocEntry)
alter table mrreg add column sap_branch_id      int;          -- "Branch ID" of its PO
alter table mrreg add column return_reasons     jsonb;        -- Return 1..3 Reason/Remarks as received
alter table mrreg add column last_seen_in_sap_at timestamptz; -- last time the feed carried this receipt
create unique index mrreg_sap_doc_entry_uq on mrreg (sap_doc_entry) where sap_doc_entry is not null;

-- Receipt lines (@ST_MRREGD)
alter table mrreg_line add column sap_line_id  int;           -- "MRReg Line" (LineId)
alter table mrreg_line add column qty_return_1 numeric(18,3);
alter table mrreg_line add column qty_return_2 numeric(18,3);
alter table mrreg_line add column qty_return_3 numeric(18,3);
alter table mrreg_line add column qty_accepted numeric(18,3); -- Qty Reg minus the three returns
alter table mrreg_line add column qty_po       numeric(18,3); -- "Qty PO" on the receipt line
alter table mrreg_line add column note         text;          -- "Note"
alter table mrreg_line add column po_match     text;          -- "PO Line Match": how SAP's line was matched to the PO line
create unique index mrreg_line_sap_line_uq on mrreg_line (mrreg_id, sap_line_id) where sap_line_id is not null;

-- Purchase orders (OPOR / POR1)
alter table purchase_order add column sap_doc_entry int;
alter table purchase_order add column sap_status    text;      -- 'O' open, 'C' closed
alter table purchase_order add column sap_canceled  boolean;
alter table purchase_order add column sap_branch_id int;
alter table purchase_order add column sap_branch    text;
alter table po_line add column sap_line_num    int;            -- "PO Line Key" (LineNum)
alter table po_line add column sap_line_status text;           -- 'O' / 'C'
alter table po_line add column warehouse       text;
alter table po_line add column cost_center     text;
alter table po_line add column uom             text;
create unique index po_line_sap_line_uq on po_line (po_id, sap_line_num) where sap_line_num is not null;

-- One row per call to the import endpoint: who sent it, what it carried, what happened.
create table sap_import_batch (
  id           bigint generated always as identity primary key,
  source       text not null,                  -- e.g. 'mrreg'
  api_key_id   bigint references api_key,
  received_at  timestamptz not null default now(),
  window_from  date,
  window_to    date,
  rows         int not null,
  result       jsonb not null                   -- counts and the rows that were skipped, with why
);

-- Every SAP row as last received, keyed by receipt and line, so nothing in the query is lost even where the platform
-- has no column for it yet.
create table sap_mrreg_row (
  mrreg_no     text not null,
  sap_line_id  int not null,
  row          jsonb not null,
  batch_id     bigint not null references sap_import_batch,
  received_at  timestamptz not null default now(),
  primary key (mrreg_no, sap_line_id)
);
