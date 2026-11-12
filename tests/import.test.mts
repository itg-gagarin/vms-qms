import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import { TEST_DB, rebuildDb } from "./helpers.mts";

const { pool, q, one } = await import("../src/lib/db.ts");
const FILE = "/tmp/vms-import-fixture.xlsx";

const HEAD = [
  "No. MRReg", "Vendor Name", "Vendor Code", "PO No.", "Item No.", "Item Group", "Item Description", "Qty Reg", "Open Qty Reg",
  "Qty PO", "Open Qty PO", "Status", "No Surat Jalan Vendor", "Create Date", "Close Date", "Close Time", "Registration Date",
  "Tanggal Surat Jalan", "Confirm Date",
];
const d = (s: string) => new Date(s + "T00:00:00Z");
const row = (mr: number, vendor: string | null, po: number, item: string | null, qty: number, status: string, sj: unknown) => [
  mr, vendor ? `Vendor ${vendor}` : null, vendor, po, item, "Raw Material Hardware", item ? `Desc ${item}` : null, qty, 0, 100, 50,
  status, sj, d("2026-11-10"), null, null, d("2026-11-10"), d("2026-11-09"), d("2026-11-10"),
];

function runImport() {
  return JSON.parse(
    execSync(`npx tsx scripts/import-mrreg.ts ${FILE}`, { env: { ...process.env, DATABASE_URL: TEST_DB }, encoding: "utf8" }),
  );
}

before(async () => {
  rebuildDb();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(HEAD);
  // MRReg with two POs and the same item twice (no line number in the export)
  ws.addRow(row(260000001, "V1", 900001, "IT-1", 10, "CLOSED", "SJ-0001"));
  ws.addRow(row(260000001, "V1", 900002, "IT-2", 5, "CLOSED", "SJ-0001"));
  ws.addRow(row(260000001, "V1", 900002, "IT-2", 5, "CLOSED", "SJ-0001"));
  // SJ number damaged by Excel into a date, and into a number
  ws.addRow(row(260000002, "V2", 900003, "IT-1", 3, "CONFIRMED", d("2026-11-11")));
  ws.addRow(row(260000003, "V2", 900003, "IT-3", 3, "CANCELED", 166435));
  // rows that cannot be imported
  ws.addRow(row(260000004, null, 900004, "IT-1", 1, "CLOSED", "X"));
  ws.addRow(row(260000005, "V3", 900005, null, 1, "CLOSED", "Y"));
  await wb.xlsx.writeFile(FILE);
});
after(async () => pool.end());

test("imports MRRegs, lines, POs; reports what it had to skip or repair", async () => {
  const r = runImport();
  assert.equal(r.mrregs, 3);
  assert.equal(r.lines, 5);
  assert.equal(r.skippedNoVendor, 1);
  assert.equal(r.skippedNoItem, 1);
  assert.equal(r.sjDate, 1);
  assert.equal(r.sjNumber, 1);
  assert.equal(r.cancelled, 1);
  const mr = await one<{ sj_no: string; sj_raw: string; receipt_date: string; sj_date: string }>(
    pool, "select sj_no, sj_raw, receipt_date, sj_date from mrreg where mrreg_no = '260000002'");
  assert.equal(mr!.sj_no, "?2026-11-11");
  assert.equal(mr!.receipt_date, "2026-11-10");
  assert.equal(mr!.sj_date, "2026-11-09");
  const pos = await q(pool, `select distinct po.po_no from mrreg m join mrreg_line l on l.mrreg_id = m.id
    join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id where m.mrreg_no = '260000001'`);
  assert.equal(pos.length, 2);
});

test("running it again changes nothing", async () => {
  const count = async () => (await one<{ n: string }>(pool,
    "select (select count(*) from mrreg)||'/'||(select count(*) from mrreg_line)||'/'||(select count(*) from po_line)||'/'||(select count(*) from supplier) as n"))!.n;
  const before = await count();
  runImport();
  assert.equal(await count(), before);
});

test("a cancelled MRReg cannot get an NCF", async () => {
  const { loadActor } = await import("../src/lib/core.ts");
  const { createDraft } = await import("../src/lib/ncf.ts");
  const qc = await loadActor(pool, (await one<{ id: number }>(pool, "select id from app_user where email = 'qc@demo.local'"))!.id);
  const mr = await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = '260000003'");
  await assert.rejects(createDraft(qc!, mr!.id), /cancelled/);
});
