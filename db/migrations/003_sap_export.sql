-- Fit the SAP MRReg export (mrreg2026.xlsx) as it is today.
-- The export has no PO date, currency, PO line number, price or requested date: those stay empty until a fuller SAP feed exists.
alter table purchase_order alter column po_date drop not null;
alter table purchase_order alter column currency drop not null;
alter table po_line alter column net_price drop not null;
alter table po_line alter column original_requested_date drop not null;
alter table po_line alter column current_delivery_date drop not null;
alter table po_line add column open_qty numeric(18,3);

alter table item add column item_group text;

-- MRReg status from SAP (OPEN, CONFIRMED, CLOSED, CANCELED). A cancelled MRReg cannot get an NCF.
alter table mrreg add column sap_status text;
alter table mrreg add column sj_raw text;                 -- No. SJ as received, when it had to be repaired
alter table mrreg_line add column qty_open numeric(18,3);
