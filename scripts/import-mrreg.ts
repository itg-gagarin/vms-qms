// Imports the SAP MRReg export (the xlsx format of mrreg2026.xlsx) until a direct SAP feed exists.
// Usage: npm run import:mrreg -- path/to/file.xlsx [--bu=BU-DEMO]
// Safe to run again: suppliers, items, POs and MRRegs are matched on their SAP numbers.
import ExcelJS from "exceljs";
import { Client } from "pg";

const REQUIRED = [
  "No. MRReg", "Vendor Name", "Vendor Code", "PO No.", "Item No.", "Item Group", "Item Description",
  "Qty Reg", "Open Qty Reg", "Qty PO", "Open Qty PO", "Status", "No Surat Jalan Vendor", "Registration Date", "Tanggal Surat Jalan",
] as const;
/** Read when present; older exports may lack them. */
const OPTIONAL = ["Create Date", "Confirm Date", "Close Date", "Close Time"] as const;

type Row = Record<(typeof REQUIRED)[number] | (typeof OPTIONAL)[number], unknown>;

const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : null);
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
/** Excel stores times as Dates on 1899-12-30, or as a fraction of a day. */
const hms = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(11, 19)
    : typeof v === "number" ? new Date(Math.round(v * 86400) * 1000).toISOString().slice(11, 19)
    : /^\d{1,2}:\d{2}/.test(text(v)) ? text(v) : null;
/** SAP exports wall-clock WIB times; store them as instants. */
const wibAt = (d: unknown, t: unknown = null) => {
  const day = ymd(d);
  if (!day) return null;
  const time = hms(t) ?? (d instanceof Date ? d.toISOString().slice(11, 19) : "00:00:00");
  return `${day}T${time}+07:00`;
};
const qty = (v: unknown) => (typeof v === "number" ? v : Number(text(v).replace(",", ".")) || 0);

/** Excel turns some SJ numbers into dates or numbers. Keep what can be kept and flag the rest. */
function cleanSj(v: unknown): { sj: string; raw: string | null; issue?: "date" | "number" | "empty" } {
  if (v === null || v === undefined || text(v) === "") return { sj: "-", raw: null, issue: "empty" };
  if (v instanceof Date) return { sj: `?${ymd(v)}`, raw: `excel-date:${ymd(v)}`, issue: "date" };
  if (typeof v === "number") return { sj: Number.isInteger(v) ? String(v) : String(v), raw: null, issue: "number" };
  if (typeof v === "object" && v && "text" in v) return { sj: text((v as { text: unknown }).text), raw: null };
  return { sj: text(v), raw: null };
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const buCode = process.argv.find((a) => a.startsWith("--bu="))?.slice(5) ?? process.env.DEFAULT_BU_CODE ?? "BU-DEMO";
  if (!file) throw new Error("Give the xlsx path: npm run import:mrreg -- file.xlsx");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).map(text);
  const col: Record<string, number> = {};
  header.forEach((h, i) => (col[h] = i));
  const missing = REQUIRED.filter((h) => col[h] === undefined);
  if (missing.length) throw new Error("Columns missing in the export: " + missing.join(", "));

  const rows: Row[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v = r.values as unknown[];
    const row = Object.fromEntries([...REQUIRED, ...OPTIONAL].map((h) => [h, col[h] === undefined ? null : v[col[h]] ?? null])) as Row;
    if (text(row["No. MRReg"])) rows.push(row);
  });

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const bu = (await c.query("select id from business_unit where code = $1", [buCode])).rows[0]?.id;
  if (!bu) throw new Error(`Business Unit ${buCode} not found. The export has no BU column, so one default BU is used.`);

  const stats = { lines: 0, mrregs: 0, skippedNoVendor: 0, skippedNoItem: 0, sjDate: 0, sjNumber: 0, sjEmpty: 0, cancelled: 0 };
  const supplierId = new Map<string, number>();
  const itemId = new Map<string, number>();
  const poId = new Map<string, number>();
  const poLineId = new Map<string, number>();
  const poLineNo = new Map<number, number>();
  const mrregId = new Map<string, number>();
  const mrregLineNo = new Map<number, number>();

  await c.query("begin");
  for (const r of rows) {
    const vendor = text(r["Vendor Code"]);
    const itemCode = text(r["Item No."]);
    if (!vendor) { stats.skippedNoVendor++; continue; }
    if (!itemCode) { stats.skippedNoItem++; continue; }

    if (!supplierId.has(vendor)) {
      const id = (await c.query(
        `insert into supplier(sap_vendor_code, name) values ($1,$2)
         on conflict (sap_vendor_code) do update set name = excluded.name returning id`,
        [vendor, text(r["Vendor Name"]) || vendor],
      )).rows[0].id;
      supplierId.set(vendor, id);
    }
    if (!itemId.has(itemCode)) {
      const id = (await c.query(
        `insert into item(sap_material_code, description, uom, item_group) values ($1,$2,'-',$3)
         on conflict (sap_material_code) do update set description = excluded.description, item_group = excluded.item_group returning id`,
        [itemCode, text(r["Item Description"]) || itemCode, text(r["Item Group"]) || null],
      )).rows[0].id;
      itemId.set(itemCode, id);
    }
    const sup = supplierId.get(vendor)!;
    const item = itemId.get(itemCode)!;

    const poNo = text(r["PO No."]) || `NO-PO-${text(r["No. MRReg"])}`;
    if (!poId.has(poNo)) {
      const id = (await c.query(
        `insert into purchase_order(po_no, supplier_id, synced_at) values ($1,$2,now())
         on conflict (po_no) do update set synced_at = now() returning id`,
        [poNo, sup],
      )).rows[0].id;
      poId.set(poNo, id);
      const max = (await c.query("select coalesce(max(line_no),0) as m from po_line where po_id = $1", [id])).rows[0].m;
      poLineNo.set(id, Number(max));
    }
    const po = poId.get(poNo)!;
    const plKey = `${po}:${item}`;
    if (!poLineId.has(plKey)) {
      const existing = (await c.query("select id from po_line where po_id = $1 and item_id = $2 order by line_no limit 1", [po, item])).rows[0];
      if (existing) {
        await c.query("update po_line set qty = $2, open_qty = $3 where id = $1", [existing.id, qty(r["Qty PO"]), qty(r["Open Qty PO"])]);
        poLineId.set(plKey, existing.id);
      } else {
        const next = (poLineNo.get(po) ?? 0) + 1;
        poLineNo.set(po, next);
        const id = (await c.query(
          "insert into po_line(po_id, line_no, item_id, qty, open_qty) values ($1,$2,$3,$4,$5) returning id",
          [po, next, item, qty(r["Qty PO"]), qty(r["Open Qty PO"])],
        )).rows[0].id;
        poLineId.set(plKey, id);
      }
    }

    const mrNo = text(r["No. MRReg"]);
    if (!mrregId.has(mrNo)) {
      const sj = cleanSj(r["No Surat Jalan Vendor"]);
      if (sj.issue === "date") stats.sjDate++;
      if (sj.issue === "number") stats.sjNumber++;
      if (sj.issue === "empty") stats.sjEmpty++;
      const status = text(r["Status"]).toUpperCase();
      if (status === "CANCELED") stats.cancelled++;
      const id = (await c.query(
        `insert into mrreg(mrreg_no, bu_id, supplier_id, sj_no, sj_raw, sj_date, receipt_date, sap_status, sap_created_at, confirmed_on, sap_closed_at, synced_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         on conflict (mrreg_no) do update set supplier_id = excluded.supplier_id, sj_no = excluded.sj_no, sj_raw = excluded.sj_raw,
           sj_date = excluded.sj_date, receipt_date = excluded.receipt_date, sap_status = excluded.sap_status,
           sap_created_at = excluded.sap_created_at, confirmed_on = excluded.confirmed_on, sap_closed_at = excluded.sap_closed_at, synced_at = now()
         returning id`,
        [mrNo, bu, sup, sj.sj, sj.raw, ymd(r["Tanggal Surat Jalan"]), ymd(r["Registration Date"]), status,
          wibAt(r["Create Date"]), ymd(r["Confirm Date"]), wibAt(r["Close Date"], r["Close Time"])],
      )).rows[0].id;
      mrregId.set(mrNo, id);
      mrregLineNo.set(id, 0);
      stats.mrregs++;
    }
    const mr = mrregId.get(mrNo)!;
    // The export has no line number: lines are numbered by row order within the MRReg.
    const lineNo = (mrregLineNo.get(mr) ?? 0) + 1;
    mrregLineNo.set(mr, lineNo);
    await c.query(
      `insert into mrreg_line(mrreg_id, line_no, po_line_id, item_id, qty_received, qty_open, uom) values ($1,$2,$3,$4,$5,$6,'-')
       on conflict (mrreg_id, line_no) do update set po_line_id = excluded.po_line_id, item_id = excluded.item_id,
         qty_received = excluded.qty_received, qty_open = excluded.qty_open`,
      [mr, lineNo, poLineId.get(plKey), item, qty(r["Qty Reg"]), qty(r["Open Qty Reg"])],
    );
    stats.lines++;
  }
  await c.query("commit");
  await c.end();
  console.log(JSON.stringify({ file, businessUnit: buCode, ...stats }, null, 2));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
