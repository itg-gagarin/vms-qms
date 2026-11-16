// Reading NCFs: one record with everything the screens show, the worklists, counts and the audit trail.
// Every read checks that the person's department may see the NCF's stage (visibility.ts).
import type { PoolClient } from "pg";
import { hasRole, type Actor } from "@/platform/access";
import type { Db } from "@/platform/db";
import { one, pool, q } from "@/platform/db";
import { AppError } from "@/platform/util";
import { STATUS_LABEL, type NcfStatus } from "./labels";
import { canRead, visibleStatuses } from "./visibility";

export type NcfRow = {
  id: number;
  ncf_no: string;
  bu_id: number;
  bu_name: string;
  supplier_id: number;
  supplier_name: string;
  supplier_code: string;
  mrreg_id: number | null;
  mrreg_no: string | null;
  po_id: number | null;
  po_no: string | null;
  status: NcfStatus;
  current_version: number;
  sj_no: string | null;
  sj_date: string | null;
  receipt_date: string | null;
  inspect_date: string;
  inspect_time: string;
  goods_status: string | null;
  hold_note: string | null;
  problem_category_id: number | null;
  problem_category: string | null;
  problem_desc: string | null;
  follow_up: string | null;
  approved_at: Date | null;
  closed_at: Date | null;
  closed_by_name: string | null;
  closure_note: string | null;
  void_reason: string | null;
  created_at: Date;
  created_by: number;
  created_by_name: string;
};

export const NCF_SELECT = `
  select n.id, n.ncf_no, n.bu_id, b.name as bu_name, n.supplier_id, s.name as supplier_name, s.sap_vendor_code as supplier_code,
         n.mrreg_id, m.mrreg_no, n.po_id, po.po_no, n.status, n.current_version,
         coalesce(n.sj_no, m.sj_no) as sj_no, coalesce(n.sj_date, m.sj_date) as sj_date,
         coalesce(n.receipt_date, m.receipt_date) as receipt_date,
         n.inspect_date, to_char(n.inspect_time, 'HH24:MI') as inspect_time, n.goods_status, n.hold_note,
         n.problem_category_id, pc.name as problem_category, n.problem_desc, n.follow_up,
         n.approved_at, n.closed_at, cu.name as closed_by_name, n.closure_note, n.void_reason,
         n.created_at, n.created_by, u.name as created_by_name
  from ncf n
  join business_unit b on b.id = n.bu_id
  join supplier s on s.id = n.supplier_id
  left join mrreg m on m.id = n.mrreg_id
  left join purchase_order po on po.id = n.po_id
  left join problem_category pc on pc.id = n.problem_category_id
  left join app_user u on u.id = n.created_by
  left join app_user cu on cu.id = n.closed_by`;

export async function lockNcf(c: PoolClient, id: number) {
  const n = await one<NcfRow>(c, `${NCF_SELECT} where n.id = $1 for update of n`, [id]);
  if (!n) throw new AppError("NCF not found.", 404);
  return n;
}

export function expectStatus(n: { status: NcfStatus }, ...allowed: NcfStatus[]) {
  if (!allowed.includes(n.status)) {
    throw new AppError(`This NCF is ${STATUS_LABEL[n.status]}. The action is not allowed in this status.`, 409);
  }
}

// ---------- Reading ----------

export async function getNcf(actor: Actor | null, id: number, db: Db = pool) {
  const n = await one<NcfRow>(db, `${NCF_SELECT} where n.id = $1`, [id]);
  if (!n) throw new AppError("NCF not found.", 404);
  if (actor && !canRead(actor, n.bu_id, n.status)) throw new AppError("This NCF is not open to your department at its current stage.", 403);
  return loadDetails(db, n);
}

export type NcfDetail = Awaited<ReturnType<typeof loadDetails>>;

/**
 * Everything the NCF screens show, in one round of parallel queries (they all key on the NCF id), so a page waits for
 * the slowest query instead of the sum of ten.
 */
/** Runs independent reads together on the pool; one after another on a transaction's client, which takes one query at a time. */
async function runAll<T extends readonly (() => Promise<unknown>)[]>(db: Db, fs: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (db === pool) return Promise.all(fs.map((f) => f())) as never;
  const out: unknown[] = [];
  for (const f of fs) out.push(await f());
  return out as never;
}

export async function loadDetails(db: Db, n: NcfRow) {
  const items = () => q<{
    id: number;
    mrreg_line_id: number | null;
    item_code: string;
    item_name: string;
    uom: string;
    po_no: string | null;
    qty_received: number;
    qty_sample: number;
    qty_defect: number;
    qty_return: number;
  }>(
    db,
    `select ni.id, ni.mrreg_line_id, i.sap_material_code as item_code, i.description as item_name, i.uom, po.po_no,
            ni.qty_received, ni.qty_sample, ni.qty_defect, ni.qty_return
     from ncf_item ni join item i on i.id = ni.item_id
     left join mrreg_line ml on ml.id = ni.mrreg_line_id
     left join po_line pl on pl.id = ml.po_line_id
     left join purchase_order po on po.id = pl.po_id
     where ni.ncf_id = $1 order by ni.id`,
    [n.id],
  );
  const evidence = () => q<{
    id: number;
    kind: string;
    caption: string | null;
    file_id: number | null;
    file_name: string | null;
    mime: string | null;
    bytes: number | null;
    sha256: string | null;
    capa_response_id: number | null;
  }>(
    db,
    `select e.id, e.kind, e.caption, e.file_id, f.file_name, f.mime, f.bytes, f.sha256, e.capa_response_id
     from evidence e left join file_object f on f.id = e.file_id
     where e.ncf_id = $1
        or e.capa_response_id in (select cr.id from capa_response cr join supplier_request r on r.id = cr.request_id where r.ncf_id = $1)
     order by e.id`,
    [n.id],
  );
  const version = () => n.current_version
    ? one<{ id: number; version_no: number; content_hash: string; verify_code: string; submitted_at: Date }>(
        db,
        "select id, version_no, content_hash, verify_code, submitted_at from ncf_version where ncf_id = $1 and version_no = $2",
        [n.id, n.current_version],
      )
    : Promise.resolve(undefined);
  const approvals = () => n.current_version
    ? q<{
        id: number;
        step_no: number;
        approver_id: number;
        title: string;
        signer_name: string;
        signer_position: string;
        decision: string | null;
        comment: string | null;
        decided_at: Date | null;
        verify_code: string | null;
      }>(
        db,
        `select a.id, a.step_no, a.approver_id, coalesce(cs.approver_title, 'QC Incoming') as title, a.signer_name, a.signer_position,
                a.decision, a.comment, a.decided_at, a.verify_code
         from ncf_approval a join ncf_version v on v.id = a.ncf_version_id and v.ncf_id = $1 and v.version_no = $3
         left join approval_chain_step cs on cs.bu_id = $2 and cs.step_no = a.step_no
         order by a.step_no`,
        [n.id, n.bu_id, n.current_version],
      )
    : Promise.resolve([]);
  const history = () => q<{ version_no: number; step_no: number; signer_name: string; decision: string | null; comment: string | null; decided_at: Date | null }>(
    db,
    `select v.version_no, a.step_no, a.signer_name, a.decision, a.comment, a.decided_at
     from ncf_approval a join ncf_version v on v.id = a.ncf_version_id
     where v.ncf_id = $1 and a.decision is not null order by a.decided_at`,
    [n.id],
  );
  const request = () => one<{
    id: number;
    ref_no: string;
    status: string;
    send_method: string | null;
    sent_at: Date | null;
    sent_by_name: string | null;
    first_opened_at: Date | null;
    responded_at: Date | null;
    response_working_days: number | null;
    closed_at: Date | null;
  }>(
    db,
    `select r.id, r.ref_no, r.status, r.send_method, r.sent_at, u.name as sent_by_name, r.first_opened_at, r.responded_at,
            r.response_working_days, r.closed_at
     from supplier_request r left join app_user u on u.id = r.sent_by where r.ncf_id = $1`,
    [n.id],
  );
  const capa = () => one<{
        id: number;
        root_cause: string | null;
        corrective_action: string | null;
        target_date: string | null;
        preventive_action: string | null;
        effective_from: string | null;
        responder_name: string | null;
        responder_position: string | null;
        responder_email: string | null;
        submitted_at: Date;
        received_via: "SUPPLIER_LINK" | "PURCHASING";
        recorded_by_name: string | null;
        extraction: { model: string | null; error: string | null; skipped: string[]; fields: Record<string, string> | null } | null;
        reviewed_at: Date | null;
        reviewed_by_name: string | null;
      }>(
        db,
        `select cr.*, ru.name as recorded_by_name, vu.name as reviewed_by_name
         from capa_response cr join supplier_request r on r.id = cr.request_id
         left join app_user ru on ru.id = cr.recorded_by left join app_user vu on vu.id = cr.reviewed_by
         where r.ncf_id = $1 and not cr.is_addendum`,
        [n.id],
      );
  const reminders = () => q<{ seq_no: number; sent_at: Date; to_supplier: boolean }>(
    db,
    "select m.seq_no, m.sent_at, m.to_supplier from reminder m join supplier_request r on r.id = m.request_id where r.ncf_id = $1 order by m.seq_no",
    [n.id],
  );
  const submittedAt = () => one<{ at: Date }>(
    db,
    "select min(submitted_at) as at from ncf_version where ncf_id = $1",
    [n.id],
  );
  const [it, ev, ver, ap, hi, req, cp, rem, sub] = await runAll(db, [items, evidence, version, approvals, history, request, capa, reminders, submittedAt] as const);
  return {
    ...n, items: it, evidence: ev, version: ver, approvals: ap, history: hi, request: req, capa: req ? cp : undefined, reminders: rem,
    firstSubmittedAt: sub?.at ?? null,
  };
}

/** The worklist filter: a tab, optionally one status, always the user's stages and Business Units. */
function worklistWhere(actor: Actor, filter: string, status?: NcfStatus, term = "", buId?: number) {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v?: unknown) => {
    if (v !== undefined) params.push(v);
    conds.push(sql.replace("$?", `$${params.length}`));
  };
  switch (filter) {
    case "mine":
      add("n.created_by = $?", actor.id);
      add("n.status in ('DRAFT','WAITING_APPROVAL')");
      break;
    case "approve":
      add(`exists (select 1 from ncf_version v join ncf_approval a on a.ncf_version_id = v.id
           where v.ncf_id = n.id and v.version_no = n.current_version and a.decision is null and a.approver_id = $?
           and a.step_no = (select min(a2.step_no) from ncf_approval a2 where a2.ncf_version_id = v.id and a2.decision is null))`, actor.id);
      add("n.status = 'WAITING_APPROVAL'");
      break;
    case "send":
      add("n.status = 'APPROVED'");
      break;
    case "waiting":
      add("n.status = 'SENT'");
      break;
    case "verify":
      add("n.status = 'RESPONDED'");
      break;
    case "closed":
      add("n.status in ('CLOSED','VOID')");
      break;
  }
  if (status) add("n.status = $?", status);
  // The Business Unit picked in the top bar (inside the user's own scope, which is applied below as well).
  if (buId) add("n.bu_id = $?", buId);
  // Search: No. Komplain, supplier name or vendor code, No. PO, No. MRReg.
  if (term.trim()) {
    params.push(term.trim());
    const t = `$${params.length}`;
    conds.push(`(n.ncf_no ilike '%' || ${t} || '%'
      or exists (select 1 from supplier s2 where s2.id = n.supplier_id and (s2.name ilike '%' || ${t} || '%' or s2.sap_vendor_code ilike '%' || ${t} || '%'))
      or exists (select 1 from purchase_order p2 where p2.id = n.po_id and p2.po_no ilike '%' || ${t} || '%')
      or exists (select 1 from mrreg m2 where m2.id = n.mrreg_id and m2.mrreg_no ilike '%' || ${t} || '%'))`);
  }
  // Each department sees only the stages it works with (core.STATUSES_BY_ROLE).
  add("n.status = any($?)", visibleStatuses(actor));
  // Business Unit scope for QC and approvers; Purchasing, PCH, Auditor and Admin see all.
  if (!hasRole(actor, ["PURCHASING", "PCH_DIV_HEAD", "AUDITOR", "SUPER_ADMIN"])) {
    const bus = actor.roles.filter((r) => r.bu_id !== null).map((r) => r.bu_id);
    add("n.bu_id = any($?)", bus);
  }
  return { where: conds.length ? "where " + conds.join(" and ") : "", params };
}

/** Worklist rows, one page at a time. `filter` is a worklist tab; `status`, when given, narrows to one NCF status. */
export async function listNcf(actor: Actor, filter: string, status?: NcfStatus, page = 1, size = 200, term = "", buId?: number) {
  const { where, params } = worklistWhere(actor, filter, status, term, buId);
  return q<{
    id: number;
    ncf_no: string;
    status: NcfStatus;
    supplier_name: string;
    bu_name: string;
    po_no: string | null;
    receipt_date: string | null;
    created_at: Date;
    items: number;
    defects: number;
  }>(
    pool,
    `select n.id, n.ncf_no, n.status, s.name as supplier_name, b.name as bu_name, po.po_no,
            coalesce(n.receipt_date, m.receipt_date) as receipt_date, n.created_at,
            (select count(*)::int from ncf_item ni where ni.ncf_id = n.id) as items,
            (select coalesce(sum(qty_defect),0) from ncf_item ni where ni.ncf_id = n.id) as defects
     from ncf n join supplier s on s.id = n.supplier_id join business_unit b on b.id = n.bu_id
     left join mrreg m on m.id = n.mrreg_id left join purchase_order po on po.id = n.po_id
     ${where} order by n.created_at desc, n.id desc limit ${Number(size)} offset ${(Number(page) - 1) * Number(size)}`,
    params,
  );
}

export async function countNcf(actor: Actor, filter: string, status?: NcfStatus, term = "", buId?: number) {
  const { where, params } = worklistWhere(actor, filter, status, term, buId);
  return (await one<{ n: number }>(pool, `select count(*)::int as n from ncf n ${where}`, params))!.n;
}

/** How many NCFs the user can see in each status (for the menu), and how many wait on the user's own signature. */
export async function statusCounts(actor: Actor, buId?: number) {
  const all = worklistWhere(actor, "all", undefined, "", buId);
  const mine = worklistWhere(actor, "approve", undefined, "", buId);
  const [rows, toSign] = await Promise.all([
    q<{ status: NcfStatus; n: number }>(pool, `select n.status, count(*)::int as n from ncf n ${all.where} group by n.status`, all.params),
    one<{ n: number }>(pool, `select count(*)::int as n from ncf n ${mine.where}`, mine.params),
  ]);
  return { byStatus: Object.fromEntries(rows.map((x) => [x.status, x.n])) as Partial<Record<NcfStatus, number>>, toSign: toSign?.n ?? 0 };
}

export async function auditTrail(id: number) {
  return q<{ at: Date; action: string; field: string | null; new_value: string | null; actor_type: string; actor_name: string | null }>(
    pool,
    `select a.at, a.action, a.field, a.new_value, a.actor_type, u.name as actor_name
     from audit_log a left join app_user u on u.id = a.actor_id and a.actor_type = 'USER'
     where a.entity = 'ncf' and a.entity_id = $1 order by a.at, a.id`,
    [id],
  );
}
