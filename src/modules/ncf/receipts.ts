// Goods receipts (MRReg) from SAP: the open-receipt list QC raises NCFs from, and a draft's PO and item choices.
import { roleScopes, type Actor } from "@/platform/access";
import type { Db } from "@/platform/db";
import { one, pool, q } from "@/platform/db";

/**
 * The receipt list: only receipts that can still get an NCF (no NCF yet, a void one does not count; not cancelled
 * in SAP), read through the partial index of migration 011. Search: No. MRReg, vendor name or code, No. SJ, PO
 * number, item code or description (any line); always the user's Business Units.
 */
function receiptWhere(actor: Actor, term: string, buId?: number) {
  const bus = roleScopes(actor, "QC_INSPECTOR");
  return {
    sql: `not m.has_live_ncf and m.sap_status is distinct from 'CANCELED'
          and ($1 = '' or m.mrreg_no ilike '%' || $1 || '%' or s.name ilike '%' || $1 || '%' or s.sap_vendor_code ilike '%' || $1 || '%'
            or m.sj_no ilike '%' || $1 || '%'
            or exists (select 1 from mrreg_line l join item i on i.id = l.item_id
                       join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
                       where l.mrreg_id = m.id and (po.po_no ilike '%' || $1 || '%' or i.sap_material_code ilike '%' || $1 || '%'
                                                    or i.description ilike '%' || $1 || '%')))
          and ($2 or m.bu_id = any($3))
          and ($4::bigint is null or m.bu_id = $4)`,
    params: [term.trim(), bus.includes(null), bus.filter((b) => b !== null), buId ?? null] as unknown[],
  };
}

export type ReceiptLine = {
  item_code: string; item_name: string; item_group: string | null; po_no: string; uom: string;
  qty_reg: number; qty_open: number | null; qty_po: number | null; open_qty_po: number | null;
};

export async function searchMrreg(actor: Actor, term: string, page = 1, size = 20, buId?: number) {
  const w = receiptWhere(actor, term, buId);
  return q<{
    id: number; bu_id: number; mrreg_no: string; supplier_name: string; vendor_code: string; sj_no: string; sj_date: string | null;
    receipt_date: string; lines: number; qty_reg: number;
    items: ReceiptLine[];
    pos: { id: number; po_no: string; lines: number }[];
  }>(
    pool,
    `select m.id, m.bu_id, m.mrreg_no, s.name as supplier_name, s.sap_vendor_code as vendor_code, m.sj_no, m.sj_date, m.receipt_date,
            (select count(*)::int from mrreg_line l where l.mrreg_id = m.id) as lines,
            (select coalesce(sum(l.qty_received), 0)::float from mrreg_line l where l.mrreg_id = m.id) as qty_reg,
            coalesce((select json_agg(json_build_object(
                        'item_code', i.sap_material_code, 'item_name', i.description, 'item_group', i.item_group, 'po_no', po.po_no, 'uom', l.uom,
                        'qty_reg', l.qty_received::float, 'qty_open', l.qty_open::float, 'qty_po', pl.qty::float, 'open_qty_po', pl.open_qty::float)
                        order by l.line_no)
                      from mrreg_line l join item i on i.id = l.item_id
                      join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
                      where l.mrreg_id = m.id), '[]') as items,
            coalesce((select json_agg(json_build_object('id', x.id, 'po_no', x.po_no, 'lines', x.lines) order by x.po_no)
                      from (select po.id, po.po_no, count(*)::int as lines from mrreg_line l
                            join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
                            where l.mrreg_id = m.id group by po.id, po.po_no) x), '[]') as pos
     from mrreg m join supplier s on s.id = m.supplier_id
     where ${w.sql}
     order by m.receipt_date desc, m.id desc limit ${Number(size)} offset ${(Number(page) - 1) * Number(size)}`,
    w.params,
  );
}

export async function countMrreg(actor: Actor, term: string, buId?: number) {
  const w = receiptWhere(actor, term, buId);
  return (await one<{ n: number }>(pool, `select count(*)::int as n from mrreg m join supplier s on s.id = m.supplier_id where ${w.sql}`, w.params))!.n;
}

export async function mrregLines(ncfId: number, db: Db = pool) {
  return q<{ id: number; line_no: number; item_code: string; item_name: string; item_group: string | null; uom: string; qty_received: number; po_no: string; used: boolean }>(
    db,
    `select l.id, l.line_no, i.sap_material_code as item_code, i.description as item_name, i.item_group, l.uom, l.qty_received, po.po_no,
            exists (select 1 from ncf_item ni where ni.ncf_id = n.id and ni.mrreg_line_id = l.id) as used
     from ncf n join mrreg_line l on l.mrreg_id = n.mrreg_id
     join item i on i.id = l.item_id join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
     where n.id = $1 and pl.po_id = n.po_id order by l.line_no`,
    [ncfId],
  );
}

/** The POs on the draft's MRReg, for the PO dropdown (one MRReg can hold several POs of the same supplier). */
export async function mrregPos(ncfId: number, db: Db = pool) {
  return q<{ id: number; po_no: string; lines: number }>(
    db,
    `select po.id, po.po_no, count(*)::int as lines
     from ncf n join mrreg_line l on l.mrreg_id = n.mrreg_id join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
     where n.id = $1 group by po.id, po.po_no order by po.po_no`,
    [ncfId],
  );
}

export async function problemCategories() {
  return q<{ id: number; name: string }>(pool, "select id, name from problem_category where active order by id");
}
