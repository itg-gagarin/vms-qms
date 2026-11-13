-- SAP Goods Receipt list: newest first, split into open receipts and those that already have an NCF (archive).
create index mrreg_receipt_order_ix on mrreg (receipt_date desc, id desc);
-- The archive test (an NCF that is not void on this MRReg) reads only live NCFs.
create index ncf_mrreg_live_ix on ncf (mrreg_id) where status <> 'VOID';
