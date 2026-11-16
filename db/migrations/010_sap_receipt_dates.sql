-- Keep every date the SAP MRReg export carries, so the receipt list reads like the export.
-- receipt_date stays the Registration Date (Tanggal Masuk) and sj_date the Tanggal Surat Jalan.
alter table mrreg add column sap_created_at timestamptz;   -- Create Date
alter table mrreg add column confirmed_on   date;          -- Confirm Date
alter table mrreg add column sap_closed_at  timestamptz;   -- Close Date + Close Time

