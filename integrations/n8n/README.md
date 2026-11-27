# SAP → QMS feed (n8n)

n8n runs the MRReg + PO query in SAP Business One and posts the rows to the QMS. The QMS stores them the same way the
xlsx importer does (suppliers, items, POs, receipts and their lines), keeps every row as received, and shows each batch
in **Master Settings → API keys → SAP feed**. Nothing else in the platform changes: QC sees the receipts in SAP Goods
Receipt as before.

```
Pull (in use):  QMS ──GET, X-API-KEY──▶ n8n webhook ──▶ SAP B1 query      every 30 min, Mon–Sat 06:00–21:00 WIB + "Sync now"
Push (ready):   n8n ──POST, Import key──▶ /api/import/sap/mrreg
```

## Pull: the platform calls the n8n webhook (current setup)

n8n exposes the query as a webhook that answers `GET` with the rows (a JSON array, the query's column names) and
checks an `X-API-KEY` header. The platform calls it on a schedule and on **Master Settings → API keys → SAP feed →
Sync now**, then imports the rows exactly as for a push. Server variables (Railway, never in the repository):

| Variable | Value |
| --- | --- |
| `SAP_FEED_URL` | the webhook URL, e.g. `https://n8n.<company domain>/webhook/mrreg-po-line` |
| `SAP_FEED_API_KEY` | the webhook's X-API-KEY |
| `SAP_FEED_SCHEDULE` | `off` stops the schedule (Sync now still works) |
| `DEFAULT_BU_CODE`, `DEFAULT_BU_NAME` | the unit receipts go to while SAP sends no branch (`INTEGRA`, `Integra Group`) |

The schedule runs inside the app server (`src/instrumentation-node.ts`) under a lease in `job_lease`, so it never runs
twice at once. Every pull, including a failed call, is listed in Settings with its source (Schedule or Sync now).

The webhook returns every receipt of the year so far (it ignores date parameters); that is fine, a resend changes
nothing. Two things to change on the n8n side when convenient:

- the webhook runs the original query, with the status and open-PO filters: cancellations and quickly closed receipts
  do not arrive (see below); use `mrreg_and_pos_sync.sql` in the n8n flow;
- "Branch ID" is empty in every row, so all receipts go to the default unit.

The sections below describe the push setup (n8n posts to the QMS), kept for when n8n should send instead of answer.

| File | What |
| --- | --- |
| `integrations/sap/mrreg_and_pos.sql` | The team's query, as given (Query Manager parameters `[%0]`, `[%1]`) |
| `integrations/sap/mrreg_and_pos_sync.sql` | The same columns for the feed: no status or open-PO filters, window `:from`/`:to` |
| `integrations/n8n/qms-sap-mrreg-feed.json` | The n8n workflow to import |

## Why the feed uses its own copy of the query

The original keeps only `OPEN`/`CONFIRMED` receipts on open PO lines. For a feed that loses data:

- a receipt cancelled in SAP never arrives as cancelled, so QC keeps seeing it as open;
- a receipt whose PO line closes before the next run (e.g. the goods receipt is posted quickly) never arrives at all.

The sync copy returns every receipt registered in the window, whatever its status, with the same 50 columns. Under
those filters the `NO PO ON MRREG` and `PO NOT FOUND` branches of "PO Line Match" could never occur; in the sync copy
they can, and the QMS stores them.

## Setup

**1. QMS: an Import key.** Master Settings → API keys → name it `n8n SAP feed`, choose **Import**, Make key. Copy it
now; it is shown once. An Import key can only send the feed; it cannot read `/api/v1`. A Read key (the VMS) cannot send.

**2. QMS: business units.** Master Settings → Business units → set **SAP branch** (`BPLId`) on each unit. Receipts of a
branch with no unit go to `DEFAULT_BU_CODE` (a Railway variable) and are listed as "unmapped branches" on every batch.
A receipt that already has an NCF never moves to another unit.

**3. SAP: register the query in Service Layer** (once, with a Service Layer user allowed to manage SQL queries):

```http
POST https://<sap-b1-server>:50000/b1s/v1/SQLQueries
Cookie: B1SESSION=<from /Login>

{ "SqlCode": "QMS_MRREG_SYNC", "SqlName": "QMS MRReg feed", "SqlText": "<contents of mrreg_and_pos_sync.sql without the comment lines>" }
```

Needs verification on your SAP version [medium confidence]: Service Layer only runs SQL it accepts, and some versions
refuse window functions (`row_number() over`) or subqueries, or only allow tables listed in `b1s_sqltable.conf` (UDO
tables such as `@ST_MRREG` must be in that list). If the query is refused, create a HANA view from the query without its
`where` clause and register `select * from "QMS_MRREG_V" where "Registration Date" between :from and :to` instead.

**4. n8n: import the workflow.** Workflows → Import from file → `qms-sap-mrreg-feed.json`. Then:

- Credentials → New → **Header Auth**, name `QMS Import key`, Name `X-API-Key`, Value = the key from step 1. Select it in
  the **Send to QMS** node.
- On the n8n host, set `SAP_SL_URL`, `SAP_COMPANY_DB`, `SAP_SL_USER`, `SAP_SL_PASSWORD`. The **Config** node reads them
  with `$env`; if your n8n blocks environment access in nodes (`N8N_BLOCK_ENV_ACCESS_IN_NODE`), allow it or type the
  values into Config (then the password lives in the workflow; a read-only SAP user limits the risk).
- Check `qmsUrl` in **Config**. Leave `slInsecureTls: true` only while Service Layer has a self-signed certificate.

**5. First load.** In **Config** set `backfillFrom` to the first date to load (e.g. `2026-01-01`), click **Run now**,
then clear `backfillFrom`. Check the **Run summary** node and Master Settings → API keys → SAP feed.

**6. Turn it on.** Activate the workflow. It runs every 30 minutes from 06:00 to 21:00 WIB, Monday to Saturday, over
the last 14 days of registrations, and at 01:00 WIB over the last 120 days to catch late cancellations and closures.

If n8n reaches HANA directly (an ODBC/JDBC node), replace **Fetch MRReg rows from SAP** with that node running
`mrreg_and_pos_sync.sql` (dates as `YYYYMMDD`) and keep the rest.

## The endpoint

`POST /api/import/sap/mrreg` with `X-API-Key: <Import key>` (or `Authorization: Bearer <key>`):

```json
{ "window": { "from": "2026-11-12", "to": "2026-11-26" },
  "rows": [ { "MRReg Entry": 9101, "No. MRReg": 260014520, "MRReg Line": 1, "Vendor Code": "V00001", "...": "..." } ] }
```

- Rows are the query's columns, named exactly as the query names them. Dates may be `2026-11-20`, `20261120` or
  `2026-11-20T00:00:00Z`; numbers may be strings. Up to 2000 rows per request (the workflow sends 500).
- Safe to send again: receipts match on No. MRReg and `LineId`, POs on PO number and `LineNum`; nothing is duplicated.
  Receipts and lines loaded earlier by the xlsx importer are taken over, not duplicated.
- A row without No. MRReg, MRReg Line, Vendor Code, Item No. or a valid Registration Date is skipped; the response
  lists each skipped row with the reason, and the other rows still load.
- Response: `{ batch, rows, suppliers, items, purchaseOrders, poLines, mrregs, lines, branchesUnmapped, skipped }`.
  `401` wrong or read-only key, `400` body not in this shape, `413` more than 2000 rows.

## Where each column goes

| Query column | QMS |
| --- | --- |
| No. MRReg, MRReg Entry, Status, Registration Date, Create Date, Confirm Date, Close Date + Close Time | `mrreg` (receipt) |
| No Surat Jalan Vendor, Tanggal Surat Jalan | `mrreg.sj_no`, `sj_date` |
| Return 1–3 Reason / Remarks | `mrreg.return_reasons` |
| Branch ID | `mrreg.bu_id` via Business units → SAP branch; also `sap_branch_id` |
| MRReg Line, Qty Reg, Open Qty Reg, Qty PO, Return 1–3, Qty Accepted, Note, UoM, PO Line Match | `mrreg_line` |
| Vendor Code, Vendor Name | `supplier` |
| Item No., Item Description, Item Group, UoM | `item` |
| PO No., PO Entry, PO Date, PO Status, PO Canceled, Branch ID, Branch | `purchase_order` |
| PO Line Key, PO Line No., PO Line Qty/Open Qty (live), PO Line Status, Delivery Date, Warehouse, Cost Center | `po_line` |
| every column | `sap_mrreg_row.row` (as received, latest per receipt line) |

## Limits to know

- A receipt changed in SAP after it left every window (older than 120 days) is not refreshed. Widen
  `nightlyWindowDays` if that matters.
- A receipt or line deleted in SAP is not deleted in the QMS (NCFs may point at it).
- The workflow has not been run against your SAP or n8n from here; steps 3 and 5 are where it is proven.
