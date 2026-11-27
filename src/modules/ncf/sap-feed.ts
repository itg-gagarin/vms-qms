// The SAP feed: rows of the MRReg + PO query (integrations/sap/mrreg_and_pos_sync.sql), sent by n8n to
// POST /api/import/sap/mrreg. Rows arrive exactly as the query names its columns. Each row is upserted on its SAP keys
// (MRReg number and LineId, PO number and LineNum), so sending the same rows again changes nothing. Every row is also
// kept as received (sap_mrreg_row). A bad row is skipped and reported; it never stops the others.
import type { PoolClient } from "pg";
import { requireRole, type Actor } from "@/platform/access";
import { audit } from "@/platform/audit";
import { one, pool, q, tx } from "@/platform/db";
import { AppError } from "@/platform/util";

/** Column names of the query, as n8n sends them. */
export const SAP_MRREG_COLUMNS = [
  "MRReg Entry", "No. MRReg", "MRReg Line", "Vendor Name", "Vendor Code", "PO No.", "Item No.", "Item Group",
  "Item Description", "Qty Reg", "Open Qty Reg", "Qty PO", "Open Qty PO", "Return 1", "Return 1 Reason", "Return 1 Remarks",
  "Return 2", "Return 2 Reason", "Return 2 Remarks", "Return 3", "Return 3 Reason", "Return 3 Remarks", "Total Return",
  "Qty Accepted", "Note", "Status", "No Surat Jalan Vendor", "Create Date", "Close Date", "Close Time", "Registration Date",
  "Tanggal Surat Jalan", "Confirm Date", "PO Entry", "PO Date", "PO Status", "PO Canceled", "Branch ID", "Branch",
  "PO Line Key", "PO Line No.", "PO Item No.", "UoM", "PO Line Qty (live)", "PO Line Open Qty (live)", "PO Line Status",
  "PO Line Delivery Date", "Warehouse", "Cost Center", "PO Line Match",
] as const;
export type SapMrregRow = Partial<Record<(typeof SAP_MRREG_COLUMNS)[number], unknown>>;

/** Most rows one request may carry; n8n sends larger results in batches. */
export const SAP_FEED_MAX_ROWS = 2000;

// ---------- Reading SAP values ----------
// HANA and the Service Layer send dates as "2026-11-12", "2026-11-12 00:00:00.000" or "2026-11-12T00:00:00Z", numbers
// as numbers or strings, and empty values as null or "".

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const opt = (v: unknown) => str(v) || null;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || str(v) === "") return null;
  const n = typeof v === "number" ? v : Number(str(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown) => { const n = num(v); return n === null ? null : Math.trunc(n); };
const day = (v: unknown) => { const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(str(v)); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const hhmm = (v: unknown) => { const m = /^(\d{1,2}):?(\d{2})/.exec(str(v)); return m ? `${m[1].padStart(2, "0")}:${m[2]}:00` : null; };
/** SAP keeps wall-clock WIB dates and times; store them as instants. */
const wib = (d: unknown, t?: unknown) => { const x = day(d); return x ? `${x}T${hhmm(t) ?? "00:00:00"}+07:00` : null; };

type Stats = {
  rows: number; suppliers: number; items: number; purchaseOrders: number;
  poLines: { inserted: number; updated: number }; mrregs: { inserted: number; updated: number };
  lines: { inserted: number; updated: number }; branchesUnmapped: number[];
  skipped: { row: number; mrreg: string; reason: string }[];
};

/**
 * Takes a batch from the feed. `apiKeyId` is the import key that sent it (checked by the route).
 * `window` is the registration-date range the query covered, kept with the batch for tracing.
 */
export async function importSapMrreg(apiKeyId: number | null, body: unknown, from: { origin?: "push" | "pull"; triggeredBy?: number | null } = {}) {
  const b = (body ?? {}) as { rows?: unknown; window?: { from?: unknown; to?: unknown } };
  if (!Array.isArray(b.rows)) throw new AppError('Send JSON: { "rows": [ ...query rows... ], "window": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } }.');
  if (b.rows.length > SAP_FEED_MAX_ROWS) throw new AppError(`At most ${SAP_FEED_MAX_ROWS} rows per request; send the rest in further batches.`, 413);
  const rows = b.rows as SapMrregRow[];
  const defaultBu = process.env.DEFAULT_BU_CODE ?? null;

  return tx(async (c) => {
    const batch = (await one<{ id: number }>(c,
      `insert into sap_import_batch(source, api_key_id, window_from, window_to, rows, result, origin, triggered_by)
       values ('mrreg', $1, $2, $3, $4, '{}', $5, $6) returning id`,
      [apiKeyId, day(b.window?.from), day(b.window?.to), rows.length, from.origin ?? "push", from.triggeredBy ?? null]))!.id;
    const s: Stats = {
      rows: rows.length, suppliers: 0, items: 0, purchaseOrders: 0, poLines: { inserted: 0, updated: 0 },
      mrregs: { inserted: 0, updated: 0 }, lines: { inserted: 0, updated: 0 }, branchesUnmapped: [], skipped: [],
    };
    const seenMrreg = new Map<string, number>();
    const fallbackBu = defaultBu ? (await one<{ id: number }>(c, "select id from business_unit where code = $1", [defaultBu]))?.id ?? null : null;

    for (const [i, r] of rows.entries()) {
      const mrregNo = str(r["No. MRReg"]);
      const skip = (reason: string) => { if (s.skipped.length < 200) s.skipped.push({ row: i, mrreg: mrregNo, reason }); };
      if (!r || typeof r !== "object") { skip("not an object"); continue; }
      const need = (["No. MRReg", "MRReg Line", "Vendor Code", "Item No.", "Registration Date"] as const).filter((k) => !str(r[k]));
      if (need.length) { skip(`missing ${need.join(", ")}`); continue; }
      if (!day(r["Registration Date"])) { skip("Registration Date is not a date"); continue; }

      await c.query("savepoint feed_row");
      try {
        await importRow(c, r, batch, s, seenMrreg, fallbackBu);
        await c.query("release savepoint feed_row");
      } catch (e) {
        await c.query("rollback to savepoint feed_row");
        seenMrreg.delete(mrregNo); // its header may have been rolled back with the row
        skip(e instanceof AppError ? e.message : `database refused the row: ${(e as Error).message}`);
      }
    }

    const result = { ...s, branchesUnmapped: [...new Set(s.branchesUnmapped)] };
    await c.query("update sap_import_batch set result = $2 where id = $1", [batch, JSON.stringify(result)]);
    await audit(c, {
      entity: "sap_import_batch", entityId: batch, action: "IMPORT", actorType: "SYSTEM",
      newValue: `${rows.length} rows: ${s.mrregs.inserted} new / ${s.mrregs.updated} updated receipts, ${s.skipped.length} skipped`,
    });
    return { batch, ...result };
  });
}

async function importRow(c: PoolClient, r: SapMrregRow, batch: number, s: Stats, seenMrreg: Map<string, number>, fallbackBu: number | null) {
  const mrregNo = str(r["No. MRReg"]);
  const lineId = int(r["MRReg Line"]);
  if (lineId === null) throw new AppError("MRReg Line is not a number");
  const vendor = str(r["Vendor Code"]);
  const itemCode = str(r["Item No."]);
  const uom = opt(r["UoM"]);

  // Supplier and item: SAP is the source of their names
  const sup = (await one<{ id: number; inserted: boolean }>(c,
    `insert into supplier(sap_vendor_code, name) values ($1, $2)
     on conflict (sap_vendor_code) do update set name = excluded.name returning id, (xmax = 0) as inserted`,
    [vendor, str(r["Vendor Name"]) || vendor]))!;
  if (sup.inserted) s.suppliers++;
  const item = (await one<{ id: number; inserted: boolean }>(c,
    `insert into item(sap_material_code, description, uom, item_group) values ($1, $2, coalesce($3, '-'), $4)
     on conflict (sap_material_code) do update set description = excluded.description,
       item_group = coalesce(excluded.item_group, item.item_group), uom = coalesce($3, item.uom)
     returning id, (xmax = 0) as inserted`,
    [itemCode, str(r["Item Description"]) || itemCode, uom, opt(r["Item Group"])]))!;
  if (item.inserted) s.items++;

  // Purchase order and its line
  const poNo = str(r["PO No."]) || `NO-PO-${mrregNo}`;
  const po = (await one<{ id: number; inserted: boolean }>(c,
    `insert into purchase_order(po_no, supplier_id, po_date, sap_doc_entry, sap_status, sap_canceled, sap_branch_id, sap_branch, synced_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (po_no) do update set po_date = coalesce(excluded.po_date, purchase_order.po_date),
       sap_doc_entry = coalesce(excluded.sap_doc_entry, purchase_order.sap_doc_entry), sap_status = coalesce(excluded.sap_status, purchase_order.sap_status),
       sap_canceled = coalesce(excluded.sap_canceled, purchase_order.sap_canceled), sap_branch_id = coalesce(excluded.sap_branch_id, purchase_order.sap_branch_id),
       sap_branch = coalesce(excluded.sap_branch, purchase_order.sap_branch), synced_at = now()
     returning id, (xmax = 0) as inserted`,
    [poNo, sup.id, day(r["PO Date"]), int(r["PO Entry"]), opt(r["PO Status"]),
      str(r["PO Canceled"]) ? str(r["PO Canceled"]).toUpperCase() === "Y" : null, int(r["Branch ID"]), opt(r["Branch"])]))!;
  if (po.inserted) s.purchaseOrders++;

  const lineNum = int(r["PO Line Key"]);
  const poQty = num(r["PO Line Qty (live)"]) ?? num(r["Qty PO"]) ?? 0;
  const poOpen = num(r["PO Line Open Qty (live)"]) ?? num(r["Open Qty PO"]);
  const delivery = day(r["PO Line Delivery Date"]);
  // The PO line by its SAP key; else a line of the same item loaded earlier without one (the xlsx import)
  const found = (lineNum !== null ? await one<{ id: number }>(c, "select id from po_line where po_id = $1 and sap_line_num = $2", [po.id, lineNum]) : undefined)
    ?? await one<{ id: number }>(c, "select id from po_line where po_id = $1 and item_id = $2 and sap_line_num is null order by line_no limit 1", [po.id, item.id]);
  let poLine: number;
  if (found) {
    await c.query(
      `update po_line set item_id = $2, qty = $3, open_qty = $4, sap_line_num = coalesce($5, sap_line_num), sap_line_status = coalesce($6, sap_line_status),
         warehouse = coalesce($7, warehouse), cost_center = coalesce($8, cost_center), uom = coalesce($9, uom),
         current_delivery_date = coalesce($10, current_delivery_date), original_requested_date = coalesce(original_requested_date, $10)
       where id = $1`,
      [found.id, item.id, poQty, poOpen, lineNum, opt(r["PO Line Status"]), opt(r["Warehouse"]), opt(r["Cost Center"]), uom, delivery]);
    poLine = found.id;
    s.poLines.updated++;
  } else {
    const wanted = int(r["PO Line No."]);
    const lineNo = (wanted !== null && !(await one(c, "select 1 from po_line where po_id = $1 and line_no = $2", [po.id, wanted])))
      ? wanted : Number((await one<{ m: number }>(c, "select coalesce(max(line_no), 0) + 1 as m from po_line where po_id = $1", [po.id]))!.m);
    poLine = (await one<{ id: number }>(c,
      `insert into po_line(po_id, line_no, item_id, qty, open_qty, sap_line_num, sap_line_status, warehouse, cost_center, uom,
         current_delivery_date, original_requested_date) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning id`,
      [po.id, lineNo, item.id, poQty, poOpen, lineNum, opt(r["PO Line Status"]), opt(r["Warehouse"]), opt(r["Cost Center"]), uom, delivery]))!.id;
    s.poLines.inserted++;
  }

  // Receipt header, once per batch. Its Business Unit comes from the PO's SAP branch.
  let mrreg = seenMrreg.get(mrregNo);
  if (mrreg === undefined) {
    const branch = int(r["Branch ID"]);
    const mapped = branch !== null ? (await one<{ id: number }>(c, "select id from business_unit where sap_branch_id = $1", [branch]))?.id : undefined;
    if (branch !== null && !mapped) s.branchesUnmapped.push(branch);
    const bu = mapped ?? fallbackBu;
    if (!bu) throw new AppError(`no Business Unit for SAP branch ${branch ?? "(none)"}: map it in Master Settings or set DEFAULT_BU_CODE`);
    const reasons = [1, 2, 3].map((n) => ({
      reason: opt(r[`Return ${n} Reason` as keyof SapMrregRow]), remarks: opt(r[`Return ${n} Remarks` as keyof SapMrregRow]),
    }));
    const h = (await one<{ id: number; inserted: boolean }>(c,
      `insert into mrreg(mrreg_no, bu_id, supplier_id, sj_no, sj_date, receipt_date, sap_status, sap_created_at, confirmed_on, sap_closed_at,
         sap_doc_entry, sap_branch_id, return_reasons, last_seen_in_sap_at, synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())
       on conflict (mrreg_no) do update set
         -- A receipt with an NCF keeps its unit; otherwise a mapped branch decides it
         bu_id = case when $14 and not mrreg.has_live_ncf then excluded.bu_id else mrreg.bu_id end,
         supplier_id = excluded.supplier_id, sj_no = excluded.sj_no, sj_raw = null, sj_date = excluded.sj_date, receipt_date = excluded.receipt_date,
         sap_status = excluded.sap_status, sap_created_at = excluded.sap_created_at, confirmed_on = excluded.confirmed_on,
         sap_closed_at = excluded.sap_closed_at, sap_doc_entry = coalesce(excluded.sap_doc_entry, mrreg.sap_doc_entry),
         sap_branch_id = coalesce(excluded.sap_branch_id, mrreg.sap_branch_id), return_reasons = excluded.return_reasons,
         last_seen_in_sap_at = now(), synced_at = now()
       returning id, (xmax = 0) as inserted`,
      [mrregNo, bu, sup.id, str(r["No Surat Jalan Vendor"]) || "-", day(r["Tanggal Surat Jalan"]), day(r["Registration Date"]),
        str(r["Status"]).toUpperCase() || null, wib(r["Create Date"]), day(r["Confirm Date"]), wib(r["Close Date"], r["Close Time"]),
        int(r["MRReg Entry"]), branch, reasons.some((x) => x.reason || x.remarks) ? JSON.stringify(reasons) : null, !!mapped]))!;
    if (h.inserted) s.mrregs.inserted++; else s.mrregs.updated++;
    mrreg = h.id;
    seenMrreg.set(mrregNo, mrreg);
  }

  // Receipt line: by its SAP LineId; else the line loaded earlier at that position without one (the xlsx import)
  const line = await one<{ id: number }>(c,
    `select id from mrreg_line where mrreg_id = $1 and (sap_line_id = $2 or (sap_line_id is null and line_no = $2))
     order by (sap_line_id = $2) desc nulls last limit 1`, [mrreg, lineId]);
  const r1 = num(r["Return 1"]) ?? 0, r2 = num(r["Return 2"]) ?? 0, r3 = num(r["Return 3"]) ?? 0;
  const qtyReg = num(r["Qty Reg"]) ?? 0;
  const values = [poLine, item.id, qtyReg, num(r["Open Qty Reg"]), uom ?? "-", lineId, r1, r2, r3,
    num(r["Qty Accepted"]) ?? qtyReg - r1 - r2 - r3, num(r["Qty PO"]), opt(r["Note"]), opt(r["PO Line Match"])];
  if (line) {
    await c.query(
      `update mrreg_line set po_line_id = $2, item_id = $3, qty_received = $4, qty_open = $5, uom = $6, sap_line_id = $7,
         qty_return_1 = $8, qty_return_2 = $9, qty_return_3 = $10, qty_accepted = $11, qty_po = $12, note = $13, po_match = $14
       where id = $1`, [line.id, ...values]);
    s.lines.updated++;
  } else {
    const lineNo = (await one(c, "select 1 from mrreg_line where mrreg_id = $1 and line_no = $2", [mrreg, lineId]))
      ? Number((await one<{ m: number }>(c, "select coalesce(max(line_no), 0) + 1 as m from mrreg_line where mrreg_id = $1", [mrreg]))!.m) : lineId;
    await c.query(
      `insert into mrreg_line(mrreg_id, line_no, po_line_id, item_id, qty_received, qty_open, uom, sap_line_id,
         qty_return_1, qty_return_2, qty_return_3, qty_accepted, qty_po, note, po_match)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [mrreg, lineNo, ...values]);
    s.lines.inserted++;
  }

  // The row as received
  await c.query(
    `insert into sap_mrreg_row(mrreg_no, sap_line_id, row, batch_id) values ($1,$2,$3,$4)
     on conflict (mrreg_no, sap_line_id) do update set row = excluded.row, batch_id = excluded.batch_id, received_at = now()`,
    [mrregNo, lineId, JSON.stringify(r), batch]);
}

/** The last batches received, for Master Settings (Super Admin). */
export async function recentSapBatches(actor: Actor, limit = 10) {
  requireRole(actor, "SUPER_ADMIN");
  return q<{ id: number; received_at: Date; window_from: string | null; window_to: string | null; rows: number; origin: string;
    by: string | null; error: string | null; mrregs_inserted: number; mrregs_updated: number; skipped: number; first_skip: string | null; unmapped: string }>(
    pool,
    `select b.id, received_at, window_from, window_to, rows, origin, u.name as by, result->>'error' as error,
       coalesce((result->'mrregs'->>'inserted')::int, 0) as mrregs_inserted, coalesce((result->'mrregs'->>'updated')::int, 0) as mrregs_updated,
       coalesce(jsonb_array_length(result->'skipped'), 0) as skipped,
       (result->'skipped'->0->>'mrreg') || ': ' || (result->'skipped'->0->>'reason') as first_skip,
       coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(result->'branchesUnmapped') x), '') as unmapped
     from sap_import_batch b left join app_user u on u.id = b.triggered_by where source = 'mrreg' order by received_at desc limit $1`,
    [limit],
  );
}

// ---------- Pull: the platform calls the n8n webhook ----------
// SAP_FEED_URL answers GET with the query rows (a JSON array); SAP_FEED_API_KEY goes in X-API-KEY. Both are server
// secrets (Railway variables), never in the repository.

export const SAP_PULL_JOB = "sap-mrreg-pull";
/** The schedule: every 30 minutes, Monday to Saturday, 06:00 to 21:00 WIB. */
export const SAP_PULL_SCHEDULE = { everyMinutes: 30, days: [1, 2, 3, 4, 5, 6], fromHour: 6, toHour: 21 };

export const sapPullConfigured = () => !!process.env.SAP_FEED_URL && !!process.env.SAP_FEED_API_KEY;

/** Whether a scheduled pull is due at `now`, given when the last one finished. */
export function sapPullDue(now: Date, lastRunAt: Date | null) {
  const w = new Date(now.getTime() + 7 * 3600 * 1000); // WIB wall clock
  const s = SAP_PULL_SCHEDULE;
  if (!s.days.includes(w.getUTCDay()) || w.getUTCHours() < s.fromHour || w.getUTCHours() > s.toHour) return false;
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= (s.everyMinutes - 1) * 60_000;
}

/**
 * Fetches all rows from the webhook and imports them (in batches of 1000). `actor` is the Super Admin who pressed
 * Sync now, or null for the schedule. A failed call is recorded as a batch with the error, so it shows in Settings.
 */
export async function pullSapMrreg(actor: Actor | null) {
  if (actor) requireRole(actor, "SUPER_ADMIN");
  const url = process.env.SAP_FEED_URL;
  const key = process.env.SAP_FEED_API_KEY;
  if (!url || !key) throw new AppError("The SAP feed is not set up: SAP_FEED_URL and SAP_FEED_API_KEY are missing on the server.");
  const triggeredBy = actor?.id ?? null;
  let rows: SapMrregRow[];
  try {
    const res = await fetch(url, { headers: { "X-API-KEY": key, accept: "application/json" }, signal: AbortSignal.timeout(180_000), cache: "no-store" });
    if (!res.ok) throw new Error(`the webhook answered HTTP ${res.status}`);
    const body: unknown = await res.json();
    const list = Array.isArray(body) ? body : (body as { rows?: unknown })?.rows;
    if (!Array.isArray(list)) throw new Error("the webhook did not return a list of rows");
    rows = list as SapMrregRow[];
  } catch (e) {
    const error = `Pull failed: ${(e as Error).message}`;
    await pool.query(
      "insert into sap_import_batch(source, rows, result, origin, triggered_by) values ('mrreg', 0, $1, 'pull', $2)",
      [JSON.stringify({ error }), triggeredBy]);
    throw new AppError(error, 502);
  }
  const dates = rows.map((r) => day(r["Registration Date"])).filter((d): d is string => !!d).sort();
  const window = { from: dates[0], to: dates.at(-1) };
  const results = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += 1000) {
    results.push(await importSapMrreg(null, { window, rows: rows.slice(i, i + 1000) }, { origin: "pull", triggeredBy }));
  }
  return {
    rows: rows.length,
    mrregsInserted: results.reduce((t, r) => t + r.mrregs.inserted, 0),
    mrregsUpdated: results.reduce((t, r) => t + r.mrregs.updated, 0),
    skipped: results.reduce((t, r) => t + r.skipped.length, 0),
  };
}
