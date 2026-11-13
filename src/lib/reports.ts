// Dashboard figures and the bulk Excel export. The main aim besides digitizing the NCF is to measure responsiveness:
// how fast suppliers answer, and how fast Integra approves and sends.
import ExcelJS from "exceljs";
import type { Actor, Role } from "./core";
import { hasRole, requireRole } from "./core";
import { one, pool, q } from "./db";
import { STATUS_LABEL, type NcfStatus } from "./labels";
import { AppError } from "./util";

export const REPORT_ROLES: Role[] = ["QC_INSPECTOR", "NCF_APPROVER", "PURCHASING", "PCH_DIV_HEAD", "AUDITOR"];
export const EXPORT_ROLES: Role[] = ["QC_INSPECTOR", "NCF_APPROVER", "AUDITOR"];

export type ReportFilter = { from: string; to: string; status?: NcfStatus; supplierId?: number; buId?: number };

/** QC and approvers see their own Business Units; everyone else every unit. */
function scope(actor: Actor) {
  if (hasRole(actor, ["PURCHASING", "PCH_DIV_HEAD", "AUDITOR", "SUPER_ADMIN"])) return null;
  return actor.roles.filter((r) => r.bu_id !== null).map((r) => r.bu_id as number);
}

/** The shared WHERE clause: period on the date the NCF was raised (WIB), scope, optional status and supplier. */
function where(actor: Actor, f: ReportFilter, opts: { drafts: boolean }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from) || !/^\d{4}-\d{2}-\d{2}$/.test(f.to)) throw new AppError("Choose a valid period.");
  if (f.from > f.to) throw new AppError("The period starts after it ends.");
  const params: unknown[] = [f.from, f.to];
  const conds = ["(n.created_at at time zone 'Asia/Jakarta')::date between $1 and $2"];
  const bus = scope(actor);
  if (bus) { params.push(bus); conds.push(`n.bu_id = any($${params.length})`); }
  // Unsubmitted drafts are working copies: only QC (and Auditor/Admin) count them.
  if (!opts.drafts || !hasRole(actor, ["QC_INSPECTOR", "AUDITOR"])) conds.push("n.status <> 'DRAFT'");
  if (f.status) { params.push(f.status); conds.push(`n.status = $${params.length}`); }
  if (f.supplierId) { params.push(f.supplierId); conds.push(`n.supplier_id = $${params.length}`); }
  if (f.buId) { params.push(f.buId); conds.push(`n.bu_id = $${params.length}`); }
  return { sql: conds.join(" and "), params };
}

export async function responseTarget() {
  const row = await one<{ value: unknown }>(
    pool, "select value from setting where key = 'response_target_wd' and valid_from <= now() order by valid_from desc limit 1",
  );
  return Number(row?.value ?? 3);
}

export async function dashboard(actor: Actor, f: ReportFilter) {
  requireRole(actor, REPORT_ROLES);
  const w = where(actor, f, { drafts: true });
  const target = await responseTarget();
  const tp = w.params.length + 1;
  const base = `from ncf n left join supplier_request r on r.ncf_id = n.id where ${w.sql}`;

  const [kpi, byStatus, monthly, suppliers, categories] = await Promise.all([
    one<{
      raised: number; open: number; closed: number; void: number; responded: number; median_wd: number | null; avg_wd: number | null;
      on_time: number; waiting: number; waiting_late: number; oldest_wd: number | null; approval_wd: number | null; send_wd: number | null;
      defect_rate: number | null;
    }>(
      pool,
      `select count(*)::int as raised,
              count(*) filter (where n.status not in ('CLOSED','VOID'))::int as open,
              count(*) filter (where n.status = 'CLOSED')::int as closed,
              count(*) filter (where n.status = 'VOID')::int as void,
              count(r.responded_at)::int as responded,
              percentile_cont(0.5) within group (order by r.response_working_days) as median_wd,
              round(avg(r.response_working_days), 1)::float as avg_wd,
              count(*) filter (where r.response_working_days <= $${tp})::int as on_time,
              count(*) filter (where n.status = 'SENT')::int as waiting,
              count(*) filter (where n.status = 'SENT' and working_days_between(r.sent_at, now()) > $${tp})::int as waiting_late,
              max(working_days_between(r.sent_at, now())) filter (where n.status = 'SENT') as oldest_wd,
              round(avg(working_days_between(
                (select min(v.submitted_at) from ncf_version v where v.ncf_id = n.id), n.approved_at)) filter (where n.approved_at is not null), 1)::float as approval_wd,
              round(avg(working_days_between(n.approved_at, r.sent_at)) filter (where r.sent_at is not null), 1)::float as send_wd,
              (select round(100.0 * sum(ni.qty_defect) / nullif(sum(ni.qty_sample), 0), 1)::float
                 from ncf_item ni where ni.ncf_id in (select n.id ${base})) as defect_rate
       ${base}`,
      [...w.params, target],
    ),
    q<{ status: NcfStatus; n: number }>(pool, `select n.status, count(*)::int as n ${base} group by n.status`, w.params),
    q<{ month: string; raised: number; avg_wd: number | null; responded: number }>(
      pool,
      `select to_char(date_trunc('month', n.created_at at time zone 'Asia/Jakarta'), 'YYYY-MM') as month, count(*)::int as raised,
              round(avg(r.response_working_days), 1)::float as avg_wd, count(r.responded_at)::int as responded
       ${base} group by 1 order by 1`,
      w.params,
    ),
    q<{ id: number; name: string; ncfs: number; responded: number; avg_wd: number | null; max_wd: number | null; waiting: number; oldest_wait: number | null; on_time: number }>(
      pool,
      `select s.id, s.name, count(*)::int as ncfs, count(r.responded_at)::int as responded,
              round(avg(r.response_working_days), 1)::float as avg_wd, max(r.response_working_days) as max_wd,
              count(*) filter (where n.status = 'SENT')::int as waiting,
              max(working_days_between(r.sent_at, now())) filter (where n.status = 'SENT') as oldest_wait,
              count(*) filter (where r.response_working_days <= $${tp})::int as on_time
       from ncf n join supplier s on s.id = n.supplier_id left join supplier_request r on r.ncf_id = n.id
       where ${w.sql} group by s.id, s.name
       -- Worst delay first, counting replies still outstanding: a supplier who never answers is the least responsive.
       order by greatest(coalesce(max(r.response_working_days), 0),
                         coalesce(max(working_days_between(r.sent_at, now())) filter (where n.status = 'SENT'), 0)) desc,
                avg(r.response_working_days) desc nulls last, count(*) desc`,
      [...w.params, target],
    ),
    q<{ name: string; n: number }>(
      pool,
      `select coalesce(pc.name, 'Not set') as name, count(*)::int as n
       from ncf n left join problem_category pc on pc.id = n.problem_category_id left join supplier_request r on r.ncf_id = n.id
       where ${w.sql} group by 1 order by 2 desc`,
      w.params,
    ),
  ]);
  return { kpi: kpi!, byStatus, monthly, suppliers, categories, target };
}

export async function supplierOptions(actor: Actor) {
  requireRole(actor, REPORT_ROLES);
  return q<{ id: number; name: string }>(pool, "select id, name from supplier order by name");
}

/** One .xlsx: sheet "NCF" one row per NCF, sheet "Items" one row per item. */
export async function exportXlsx(actor: Actor, f: ReportFilter) {
  requireRole(actor, EXPORT_ROLES);
  const w = where(actor, f, { drafts: true });
  const rows = await q<Record<string, unknown>>(
    pool,
    `select n.id, n.ncf_no, n.status, b.name as bu, s.sap_vendor_code as supplier_code, s.name as supplier, m.mrreg_no, po.po_no,
            coalesce(n.sj_no, m.sj_no) as sj_no, coalesce(n.sj_date, m.sj_date) as sj_date, coalesce(n.receipt_date, m.receipt_date) as receipt_date,
            n.inspect_date, to_char(n.inspect_time, 'HH24:MI') as inspect_time, n.goods_status, pc.name as category, n.problem_desc, n.follow_up,
            (select count(*)::int from ncf_item ni where ni.ncf_id = n.id) as items,
            (select sum(qty_received) from ncf_item ni where ni.ncf_id = n.id) as qty_received,
            (select sum(qty_sample) from ncf_item ni where ni.ncf_id = n.id) as qty_sample,
            (select sum(qty_defect) from ncf_item ni where ni.ncf_id = n.id) as qty_defect,
            (select sum(qty_return) from ncf_item ni where ni.ncf_id = n.id) as qty_return,
            u.name as created_by, n.created_at, (select min(submitted_at) from ncf_version v where v.ncf_id = n.id) as submitted_at,
            n.current_version, n.approved_at,
            (select string_agg(a.signer_name || ' (' || coalesce(cs.approver_title, 'QC') || ') ' ||
                    to_char(a.decided_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI'), '; ' order by a.step_no)
               from ncf_approval a join ncf_version v on v.id = a.ncf_version_id
               left join approval_chain_step cs on cs.bu_id = n.bu_id and cs.step_no = a.step_no
               where v.ncf_id = n.id and v.version_no = n.current_version and a.decision = 'APPROVED') as signatures,
            r.sent_at as link_generated_at, r.responded_at as returned_at, r.response_working_days,
            case when n.status = 'SENT' then working_days_between(r.sent_at, now()) end as waiting_working_days,
            (select count(*)::int from evidence e where e.capa_response_id = cr.id and e.file_id is not null) as reply_files, n.closed_at, cu.name as closed_by, n.void_reason
     from ncf n
     join business_unit b on b.id = n.bu_id join supplier s on s.id = n.supplier_id
     left join mrreg m on m.id = n.mrreg_id left join purchase_order po on po.id = n.po_id
     left join problem_category pc on pc.id = n.problem_category_id
     left join app_user u on u.id = n.created_by left join app_user cu on cu.id = n.closed_by
     left join supplier_request r on r.ncf_id = n.id
     left join capa_response cr on cr.request_id = r.id and not cr.is_addendum
     where ${w.sql} order by n.created_at`,
    w.params,
  );
  const items = await q<Record<string, unknown>>(
    pool,
    `select n.ncf_no, n.status, s.name as supplier, po.po_no, i.sap_material_code as item_code, i.description as item_name, i.uom,
            ni.qty_received, ni.qty_sample, ni.qty_defect, round(100.0 * ni.qty_defect / nullif(ni.qty_sample, 0), 1)::float as defect_pct, ni.qty_return
     from ncf_item ni join ncf n on n.id = ni.ncf_id join supplier s on s.id = n.supplier_id join item i on i.id = ni.item_id
     left join mrreg_line ml on ml.id = ni.mrreg_line_id left join po_line pl on pl.id = ml.po_line_id left join purchase_order po on po.id = pl.po_id
     left join supplier_request r on r.ncf_id = n.id
     where ${w.sql} order by n.created_at, ni.id`,
    w.params,
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "VMS · NCF";
  const sheet = (name: string, cols: [string, string, number][], data: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = cols.map(([key, header, width]) => ({ key, header, width }));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    for (const r of data) {
      ws.addRow(Object.fromEntries(cols.map(([k]) => {
        const v = r[k];
        if (k === "status") return [k, STATUS_LABEL[v as NcfStatus] ?? v];
        // Excel has no time zone: write WIB wall-clock time, and plain dates as dates.
        if (v instanceof Date) return [k, new Date(v.getTime() + 7 * 3600_000)];
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return [k, new Date(`${v}T00:00:00Z`)];
        return [k, v ?? ""];
      })));
    }
    for (const [i, [key]] of cols.entries()) {
      if (/_at$/.test(key)) ws.getColumn(i + 1).numFmt = "dd/mm/yyyy hh:mm";
      if (/date$/.test(key) || key === "effective_from") ws.getColumn(i + 1).numFmt = "dd/mm/yyyy";
    }
    return ws;
  };
  sheet("NCF", [
    ["ncf_no", "No. Komplain", 14], ["status", "Status", 20], ["bu", "Business Unit", 18], ["supplier_code", "Vendor Code", 12],
    ["supplier", "Supplier", 26], ["mrreg_no", "No. MRReg", 16], ["po_no", "No. PO", 14], ["sj_no", "No. SJ", 14],
    ["sj_date", "Tanggal SJ", 12], ["receipt_date", "Tanggal Masuk", 13], ["inspect_date", "Tanggal Periksa", 14], ["inspect_time", "Jam Periksa", 10],
    ["goods_status", "Status barang", 12], ["category", "Kategori", 18], ["problem_desc", "Uraian masalah", 40], ["follow_up", "Tindak lanjut", 30],
    ["items", "Items", 7], ["qty_received", "Jumlah Datang", 12], ["qty_sample", "Jumlah Sample", 12], ["qty_defect", "Jumlah Cacat", 12],
    ["qty_return", "Qty Retur", 10], ["created_by", "Dibuat oleh", 16], ["created_at", "Dibuat", 16], ["submitted_at", "Diajukan", 16],
    ["current_version", "Versi", 7], ["approved_at", "Disetujui", 16], ["signatures", "Tanda tangan", 60],
    ["link_generated_at", "Dikirim ke supplier (jam mulai)", 22], ["returned_at", "Balasan diterima (jam berhenti)", 22],
    ["response_working_days", "Respons (hari kerja)", 12], ["waiting_working_days", "Menunggu (hari kerja)", 12],
    ["reply_files", "File balasan supplier", 12], ["closed_at", "Ditutup", 16], ["closed_by", "Ditutup oleh", 16],
    ["void_reason", "Alasan void", 30],
  ], rows);
  sheet("Items", [
    ["ncf_no", "No. Komplain", 14], ["status", "Status", 20], ["supplier", "Supplier", 26], ["po_no", "No. PO", 14],
    ["item_code", "Kode Barang", 24], ["item_name", "Nama Barang", 36], ["uom", "UoM", 7], ["qty_received", "Jumlah Datang", 12],
    ["qty_sample", "Jumlah Sample", 12], ["qty_defect", "Jumlah Cacat", 12], ["defect_pct", "% Cacat", 9], ["qty_return", "Qty Retur", 10],
  ], items);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), ncfs: rows.length, items: items.length };
}
