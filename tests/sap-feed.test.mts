import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import { rebuildDb } from "./helpers.mts";

// The SAP feed from n8n. Rows have the shape of integrations/sap/mrreg_and_pos_sync.sql with made-up suppliers and
// numbers (never rows from a real export).
process.env.DEFAULT_BU_CODE = "BU-DEMO";
const { pool, one, q } = await import("../src/platform/db.ts");
const { loadActor } = await import("../src/platform/access.ts");
const { createApiKey, checkApiKey } = await import("../src/platform/api-keys.ts");
const adm = await import("../src/modules/admin/index.ts");
const ncf = await import("../src/modules/ncf/index.ts");
const route = await import("../src/app/api/import/sap/mrreg/route.ts");
const jobs = await import("../src/platform/jobs.ts");

type Actor = NonNullable<Awaited<ReturnType<typeof loadActor>>>;
let admin: Actor, qc: Actor;

/** One query row; `o` overrides columns. */
const row = (o: Record<string, unknown> = {}) => ({
  "MRReg Entry": 9101, "No. MRReg": 269900001, "MRReg Line": 1, "Vendor Name": "Contoh Rotan Lestari, PT", "Vendor Code": "VTEST001",
  "PO No.": 269800001, "Item No.": "RM.TEST.0001", "Item Group": "Raw Material Rotan", "Item Description": "Rotan Uji 5 mm",
  "Qty Reg": "150.000000", "Open Qty Reg": "150.000000", "Qty PO": "300.000000", "Open Qty PO": "300.000000",
  "Return 1": "5.000000", "Return 1 Reason": "Cacat", "Return 1 Remarks": "Retak", "Return 2": 0, "Return 2 Reason": null, "Return 2 Remarks": null,
  "Return 3": 0, "Return 3 Reason": null, "Return 3 Remarks": null, "Total Return": 5, "Qty Accepted": 145, "Note": "Cek ulang",
  "Status": "OPEN", "No Surat Jalan Vendor": "SJ-UJI-01", "Create Date": "2026-11-20 00:00:00.000", "Close Date": null, "Close Time": null,
  "Registration Date": "2026-11-20T00:00:00Z", "Tanggal Surat Jalan": "2026-11-19", "Confirm Date": null,
  "PO Entry": 7101, "PO Date": "2026-11-01", "PO Status": "O", "PO Canceled": "N", "Branch ID": 1, "Branch": "Cabang Uji",
  "PO Line Key": 0, "PO Line No.": 1, "PO Item No.": "RM.TEST.0001", "UoM": "KG", "PO Line Qty (live)": "300.000000",
  "PO Line Open Qty (live)": "150.000000", "PO Line Status": "O", "PO Line Delivery Date": "2026-11-18", "Warehouse": "WH-RM",
  "Cost Center": "PRD", "PO Line Match": "UNIQUE ITEM+QTY", ...o,
});
const rows = [
  row(),
  row({ "MRReg Line": 2, "Item No.": "RM.TEST.0002", "Item Description": "Rotan Uji 7 mm", "PO Line Key": 1, "PO Line No.": 2, "Return 1": 0, "Qty Accepted": 150 }),
  row({ "No. MRReg": 269900002, "MRReg Entry": 9102, "Branch ID": 7, "Branch": "Cabang Tujuh", "PO No.": 269800002, "PO Entry": 7102, "Status": "CONFIRMED" }),
];

before(async () => {
  rebuildDb();
  const id = async (e: string) => (await one<{ id: number }>(pool, "select id from app_user where email = $1", [e]))!.id;
  admin = (await loadActor(pool, await id("admin@demo.local")))!;
  qc = (await loadActor(pool, await id("qc@demo.local")))!;
});
after(async () => pool.end());

describe("SAP feed", () => {
  test("a batch lands in suppliers, items, POs, receipts and lines, and keeps every row as received", async () => {
    // Branch 1 belongs to the demo unit; branch 7 is not mapped yet and goes to DEFAULT_BU_CODE
    const demo = (await one<{ id: number }>(pool, "select id from business_unit where code = 'BU-DEMO'"))!.id;
    await adm.saveUnit(admin, demo, "BU-DEMO", "Demo Business Unit", 1);
    const r = await ncf.importSapMrreg(null, { window: { from: "2026-11-01", to: "2026-11-26" }, rows });
    assert.deepEqual(r.mrregs, { inserted: 2, updated: 0 });
    assert.deepEqual(r.lines, { inserted: 3, updated: 0 });
    assert.deepEqual(r.branchesUnmapped, [7]);
    assert.equal(r.skipped.length, 0);

    const m = (await one<{ bu: string; sap_status: string; receipt_date: string; sj_no: string; sap_doc_entry: number; return_reasons: unknown }>(pool,
      `select b.code as bu, m.sap_status, m.receipt_date, m.sj_no, m.sap_doc_entry, m.return_reasons
       from mrreg m join business_unit b on b.id = m.bu_id where m.mrreg_no = '269900001'`))!;
    assert.equal(m.bu, "BU-DEMO");
    assert.equal(m.receipt_date, "2026-11-20");
    assert.equal(m.sap_doc_entry, 9101);
    assert.equal((m.return_reasons as { reason: string }[])[0].reason, "Cacat");
    const lines = await q<{ line_no: number; sap_line_id: number; qty_received: number; qty_return_1: number; qty_accepted: number; uom: string; po_match: string }>(pool,
      `select l.line_no, l.sap_line_id, l.qty_received, l.qty_return_1, l.qty_accepted, l.uom, l.po_match
       from mrreg_line l join mrreg m on m.id = l.mrreg_id where m.mrreg_no = '269900001' order by l.line_no`);
    assert.deepEqual(lines.map((l) => [l.line_no, l.sap_line_id, l.qty_received, l.qty_return_1, l.qty_accepted, l.uom]),
      [[1, 1, 150, 5, 145, "KG"], [2, 2, 150, 0, 150, "KG"]]);
    const pl = (await one<{ sap_line_num: number; open_qty: number; warehouse: string; current_delivery_date: string }>(pool,
      `select pl.sap_line_num, pl.open_qty, pl.warehouse, pl.current_delivery_date from po_line pl join purchase_order p on p.id = pl.po_id
       where p.po_no = '269800001' and pl.line_no = 2`))!;
    assert.deepEqual([pl.sap_line_num, pl.open_qty, pl.warehouse, pl.current_delivery_date], [1, 150, "WH-RM", "2026-11-18"]);
    assert.equal((await one<{ n: number }>(pool, "select count(*)::int as n from sap_mrreg_row"))!.n, 3);

    // QC sees the new receipt in SAP Goods Receipt, like an imported one
    assert.ok((await ncf.searchMrreg(qc, "269900001")).length === 1);
  });

  test("sending the same rows again adds nothing; changes in SAP update the rows", async () => {
    const changed = rows.map((x, i) => (i === 0 ? { ...x, "Status": "CLOSED", "Close Date": "2026-11-25", "Close Time": 1430 } : x));
    const r = await ncf.importSapMrreg(null, { rows: changed });
    assert.deepEqual(r.mrregs, { inserted: 0, updated: 2 });
    assert.deepEqual(r.lines, { inserted: 0, updated: 3 });
    assert.equal((await one<{ n: number }>(pool, "select count(*)::int as n from mrreg_line l join mrreg m on m.id = l.mrreg_id where m.mrreg_no like '2699%'"))!.n, 3);
    const m = (await one<{ sap_status: string; closed: string }>(pool,
      "select sap_status, to_char(sap_closed_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') as closed from mrreg where mrreg_no = '269900001'"))!;
    assert.deepEqual([m.sap_status, m.closed], ["CLOSED", "2026-11-25 14:30"]);
  });

  test("a bad row is skipped and reported; the rest still import", async () => {
    const r = await ncf.importSapMrreg(null, { rows: [row({ "No. MRReg": 269900003, "Vendor Code": "" }), row({ "No. MRReg": 269900004, "MRReg Entry": 9104, "Registration Date": "soon" }), row({ "No. MRReg": 269900005, "MRReg Entry": 9105 })] });
    assert.deepEqual(r.skipped.map((s) => s.reason), ["missing Vendor Code", "Registration Date is not a date"]);
    assert.equal(r.mrregs.inserted, 1);
    await assert.rejects(ncf.importSapMrreg(null, { nope: true }), /Send JSON/);
  });

  test("the endpoint takes Import keys only; /api/v1 takes Read keys only", async () => {
    const readKey = await createApiKey(admin, "VMS reports", "read");
    const importKey = await createApiKey(admin, "n8n SAP feed", "import");
    const post = (key: string, body: unknown) => route.POST(new Request("http://test.local/api/import/sap/mrreg", {
      method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    assert.equal((await post(readKey, { rows: [] })).status, 401);
    const ok = await post(importKey, { rows: [row({ "No. MRReg": 269900006, "MRReg Entry": 9106 })] });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).mrregs.inserted, 1);
    const get = (key: string) => new Request("http://test.local/api/v1/ncfs", { headers: { authorization: `Bearer ${key}` } });
    assert.ok(await checkApiKey(get(readKey), "read"));
    assert.equal(await checkApiKey(get(importKey), "read"), null);
    const batch = (await one<{ api_key_id: number; n: number }>(pool,
      "select api_key_id, (select count(*)::int from audit_log where entity = 'sap_import_batch') as n from sap_import_batch order by id desc limit 1"))!;
    assert.ok(batch.api_key_id);
    assert.ok(batch.n >= 4, "every batch is in the audit log");
  });

  test("a receipt with an NCF keeps its business unit when its branch is mapped later", async () => {
    const r7 = (await one<{ id: number; bu_id: number }>(pool, "select id, bu_id from mrreg where mrreg_no = '269900002'"))!;
    const unit = await adm.saveUnit(admin, null, "BU-TUJUH", "Unit Tujuh", 7);
    await pool.query("update mrreg set has_live_ncf = true where id = $1", [r7.id]);
    await ncf.importSapMrreg(null, { rows: [rows[2]] });
    assert.equal((await one<{ bu_id: number }>(pool, "select bu_id from mrreg where id = $1", [r7.id]))!.bu_id, r7.bu_id);
    await ncf.importSapMrreg(null, { rows: [row({ "No. MRReg": 269900007, "MRReg Entry": 9107, "Branch ID": 7 })] });
    assert.equal((await one<{ bu_id: number }>(pool, "select bu_id from mrreg where mrreg_no = '269900007'"))!.bu_id, unit);
  });
});

describe("SAP feed, pull from the n8n webhook", () => {
  test("pulls the rows with the key, imports them, and records a failed call", async () => {
    let seenKey = "";
    let fail = false;
    const server = createServer((req, res) => {
      seenKey = String(req.headers["x-api-key"] ?? "");
      if (fail) { res.writeHead(500).end("{}"); return; }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([row({ "No. MRReg": 269900020, "MRReg Entry": 9120 }), row({ "No. MRReg": 269900020, "MRReg Entry": 9120, "MRReg Line": 2, "Item No.": "RM.TEST.0003", "PO Line Key": 2 })]));
    });
    await new Promise<void>((ok) => server.listen(0, ok));
    process.env.SAP_FEED_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/webhook/mrreg-po-line`;
    process.env.SAP_FEED_API_KEY = "test-feed-key";
    try {
      await assert.rejects(ncf.pullSapMrreg(qc), /role/);
      const r = await ncf.pullSapMrreg(admin);
      assert.equal(seenKey, "test-feed-key");
      assert.deepEqual([r.rows, r.mrregsInserted, r.skipped], [2, 1, 0]);
      const b = (await one<{ origin: string; triggered_by: number; window_from: string }>(pool,
        "select origin, triggered_by, window_from from sap_import_batch order by id desc limit 1"))!;
      assert.deepEqual([b.origin, b.triggered_by, b.window_from], ["pull", admin.id, "2026-11-20"]);
      fail = true;
      await assert.rejects(ncf.pullSapMrreg(null), /Pull failed: the webhook answered HTTP 500/);
      assert.match((await one<{ e: string }>(pool, "select result->>'error' as e from sap_import_batch order by id desc limit 1"))!.e, /HTTP 500/);
      const shown = await ncf.recentSapBatches(admin);
      assert.equal(shown[0].origin, "pull");
      assert.match(shown[0].error!, /HTTP 500/);
    } finally {
      server.close();
      delete process.env.SAP_FEED_URL;
      delete process.env.SAP_FEED_API_KEY;
    }
  });

  test("the schedule: every 30 minutes, Monday to Saturday, 06:00-21:00 WIB", () => {
    const wibAt = (s: string) => new Date(s + "+07:00");
    assert.equal(ncf.sapPullDue(wibAt("2026-11-27T09:00:00"), null), true);                           // Friday morning
    assert.equal(ncf.sapPullDue(wibAt("2026-11-27T09:10:00"), wibAt("2026-11-27T09:00:00")), false); // 10 minutes later
    assert.equal(ncf.sapPullDue(wibAt("2026-11-27T09:30:00"), wibAt("2026-11-27T09:00:00")), true);
    assert.equal(ncf.sapPullDue(wibAt("2026-11-27T05:59:00"), null), false);                          // before 06:00
    assert.equal(ncf.sapPullDue(wibAt("2026-11-27T22:00:00"), null), false);                          // after 21:59
    assert.equal(ncf.sapPullDue(wibAt("2026-11-29T10:00:00"), null), false);                          // Sunday
  });

  test("a job runs on one server at a time", async () => {
    let inside = 0, max = 0;
    const job = () => jobs.withLease("test-job", 5, async () => { inside++; max = Math.max(max, inside); await new Promise((r) => setTimeout(r, 50)); inside--; });
    const ran = await Promise.all([job(), job(), job()]);
    assert.equal(ran.filter(Boolean).length, 1);
    assert.equal(max, 1);
    assert.ok(await jobs.lastRun("test-job"));
    assert.equal(await job(), true, "free again once the run is over");
  });
});
