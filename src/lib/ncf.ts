// NCF business rules (FD sections 4 to 11). Every function checks the actor's role and the NCF status itself,
// so the screens cannot bypass a rule.
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import type { Actor } from "./core";
import {
  audit,
  canRead,
  enqueue,
  getSetting,
  hasRole,
  requireRole,
  roleScopes,
  usersWithRole,
  visibleStatuses,
} from "./core";
import { nextNumber } from "./admin";
import type { Db } from "./db";
import { one, pool, q, tx } from "./db";
import { LIMITS, saveFile } from "./files";
import { AppError, appUrl, canonicalJson, num, randomToken, sha256, wib } from "./util";

import { GOODS_STATUS, STATUS_LABEL, type NcfStatus } from "./labels";
export { GOODS_STATUS, STATUS_LABEL, type NcfStatus };

type NcfRow = {
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

const NCF_SELECT = `
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

async function lockNcf(c: PoolClient, id: number) {
  const n = await one<NcfRow>(c, `${NCF_SELECT} where n.id = $1 for update of n`, [id]);
  if (!n) throw new AppError("NCF not found.", 404);
  return n;
}

function expectStatus(n: { status: NcfStatus }, ...allowed: NcfStatus[]) {
  if (!allowed.includes(n.status)) {
    throw new AppError(`This NCF is ${STATUS_LABEL[n.status]}. The action is not allowed in this status.`, 409);
  }
}

async function checkPassword(c: Db, actor: Actor, password: string) {
  const row = await one<{ password_hash: string | null }>(c, "select password_hash from app_user where id = $1", [actor.id]);
  if (!password || !row?.password_hash || !(await bcrypt.compare(password, row.password_hash))) {
    throw new AppError("Password is not correct. Your signature was not recorded.", 401);
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

async function loadDetails(db: Db, n: NcfRow) {
  const items = await q<{
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
  const evidence = await q<{
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
  const version = n.current_version
    ? await one<{ id: number; version_no: number; content_hash: string; verify_code: string; submitted_at: Date }>(
        db,
        "select id, version_no, content_hash, verify_code, submitted_at from ncf_version where ncf_id = $1 and version_no = $2",
        [n.id, n.current_version],
      )
    : undefined;
  const approvals = version
    ? await q<{
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
         from ncf_approval a
         left join approval_chain_step cs on cs.bu_id = $2 and cs.step_no = a.step_no
         where a.ncf_version_id = $1 order by a.step_no`,
        [version.id, n.bu_id],
      )
    : [];
  const history = await q<{ version_no: number; step_no: number; signer_name: string; decision: string | null; comment: string | null; decided_at: Date | null }>(
    db,
    `select v.version_no, a.step_no, a.signer_name, a.decision, a.comment, a.decided_at
     from ncf_approval a join ncf_version v on v.id = a.ncf_version_id
     where v.ncf_id = $1 and a.decision is not null order by a.decided_at`,
    [n.id],
  );
  const request = await one<{
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
  const capa = request
    ? await one<{
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
         from capa_response cr left join app_user ru on ru.id = cr.recorded_by left join app_user vu on vu.id = cr.reviewed_by
         where cr.request_id = $1 and not cr.is_addendum`,
        [request.id],
      )
    : undefined;
  const reminders = request
    ? await q<{ seq_no: number; sent_at: Date; to_supplier: boolean }>(
        db,
        "select seq_no, sent_at, to_supplier from reminder where request_id = $1 order by seq_no",
        [request.id],
      )
    : [];
  const submittedAt = await one<{ at: Date }>(
    db,
    "select min(submitted_at) as at from ncf_version where ncf_id = $1",
    [n.id],
  );
  return { ...n, items, evidence, version, approvals, history, request, capa, reminders, firstSubmittedAt: submittedAt?.at ?? null };
}

/** Worklist rows. `filter` is a worklist tab; `status`, when given, narrows to one NCF status. */
export async function listNcf(actor: Actor, filter: string, status?: NcfStatus) {
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
  // Each department sees only the stages it works with (core.STATUSES_BY_ROLE).
  add("n.status = any($?)", visibleStatuses(actor));
  // Business Unit scope for QC and approvers; Purchasing, PCH, Auditor and Admin see all.
  if (!hasRole(actor, ["PURCHASING", "PCH_DIV_HEAD", "AUDITOR", "SUPER_ADMIN"])) {
    const bus = actor.roles.filter((r) => r.bu_id !== null).map((r) => r.bu_id);
    add("n.bu_id = any($?)", bus);
  }
  const where = conds.length ? "where " + conds.join(" and ") : "";
  return q<{
    id: number;
    ncf_no: string;
    status: NcfStatus;
    supplier_name: string;
    bu_name: string;
    receipt_date: string | null;
    created_at: Date;
    items: number;
    defects: number;
  }>(
    pool,
    `select n.id, n.ncf_no, n.status, s.name as supplier_name, b.name as bu_name,
            coalesce(n.receipt_date, m.receipt_date) as receipt_date, n.created_at,
            (select count(*)::int from ncf_item ni where ni.ncf_id = n.id) as items,
            (select coalesce(sum(qty_defect),0) from ncf_item ni where ni.ncf_id = n.id) as defects
     from ncf n join supplier s on s.id = n.supplier_id join business_unit b on b.id = n.bu_id
     left join mrreg m on m.id = n.mrreg_id
     ${where} order by n.created_at desc limit 200`,
    params,
  );
}

export async function searchMrreg(actor: Actor, term: string) {
  const bus = roleScopes(actor, "QC_INSPECTOR");
  const all = bus.includes(null);
  return q<{
    id: number; mrreg_no: string; supplier_name: string; sj_no: string; receipt_date: string; lines: number; sap_status: string | null;
    pos: { id: number; po_no: string; lines: number }[];
  }>(
    pool,
    `select m.id, m.mrreg_no, s.name as supplier_name, m.sj_no, m.receipt_date, m.sap_status,
            (select count(*)::int from mrreg_line l where l.mrreg_id = m.id) as lines,
            coalesce((select json_agg(json_build_object('id', x.id, 'po_no', x.po_no, 'lines', x.lines) order by x.po_no)
                      from (select po.id, po.po_no, count(*)::int as lines from mrreg_line l
                            join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
                            where l.mrreg_id = m.id group by po.id, po.po_no) x), '[]') as pos
     from mrreg m join supplier s on s.id = m.supplier_id
     where ($1 = '' or m.mrreg_no ilike '%' || $1 || '%' or s.name ilike '%' || $1 || '%' or m.sj_no ilike '%' || $1 || '%')
       and ($2 or m.bu_id = any($3))
     order by m.receipt_date desc limit 30`,
    [term.trim(), all, bus.filter((b) => b !== null)],
  );
}

export async function mrregLines(ncfId: number, db: Db = pool) {
  return q<{ id: number; line_no: number; item_code: string; item_name: string; uom: string; qty_received: number; po_no: string; used: boolean }>(
    db,
    `select l.id, l.line_no, i.sap_material_code as item_code, i.description as item_name, l.uom, l.qty_received, po.po_no,
            exists (select 1 from ncf_item ni where ni.ncf_id = n.id and ni.mrreg_line_id = l.id) as used
     from ncf n join mrreg_line l on l.mrreg_id = n.mrreg_id
     join item i on i.id = l.item_id join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
     where n.id = $1 and (n.po_id is null or pl.po_id = n.po_id) order by l.line_no`,
    [ncfId],
  );
}

export async function problemCategories() {
  return q<{ id: number; name: string }>(pool, "select id, name from problem_category where active order by id");
}

// ---------- Draft (Part 1) ----------

/** A new draft for one PO of the MRReg. `poId` may be left out when the MRReg holds a single PO. */
export async function createDraft(actor: Actor, mrregId: number, now = new Date(), poId?: number) {
  return tx(async (c) => {
    const m = await one<{ id: number; bu_id: number; supplier_id: number; sj_no: string; sj_date: string; receipt_date: string; sap_status: string | null }>(
      c,
      "select id, bu_id, supplier_id, sj_no, sj_date, receipt_date, sap_status from mrreg where id = $1",
      [mrregId],
    );
    if (!m) throw new AppError("MRReg not found.", 404);
    if (m.sap_status === "CANCELED") throw new AppError("This MRReg is cancelled in SAP. An NCF cannot be created for it.", 409);
    requireRole(actor, "QC_INSPECTOR", m.bu_id);
    const pos = await q<{ id: number }>(
      c,
      "select distinct pl.po_id as id from mrreg_line l join po_line pl on pl.id = l.po_line_id where l.mrreg_id = $1",
      [m.id],
    );
    const po = poId ?? (pos.length === 1 ? pos[0].id : undefined);
    if (pos.length > 1 && po === undefined) throw new AppError("This MRReg holds several POs. Choose the PO first.");
    if (po !== undefined && !pos.some((p) => p.id === po)) throw new AppError("This PO is not on the MRReg.");
    const bu = await one<{ code: string }>(c, "select code from business_unit where id = $1", [m.bu_id]);
    const no = await nextNumber(c, now, bu!.code);
    const t = wib(now);
    const row = await one<{ id: number }>(
      c,
      `insert into ncf(ncf_no, bu_id, supplier_id, mrreg_id, po_id, sj_no, sj_date, receipt_date, inspect_date, inspect_time, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [no, m.bu_id, m.supplier_id, m.id, po ?? null, m.sj_no, m.sj_date, m.receipt_date, t.date, t.time, actor.id, now],
    );
    await audit(c, { entity: "ncf", entityId: row!.id, action: "CREATE", newValue: no, actorType: "USER", actorId: actor.id });
    return row!.id;
  });
}

async function draftForEdit(c: PoolClient, actor: Actor, id: number) {
  const n = await lockNcf(c, id);
  expectStatus(n, "DRAFT");
  requireRole(actor, "QC_INSPECTOR", n.bu_id);
  return n;
}

export type HeaderInput = {
  inspect_date: string;
  inspect_time: string;
  goods_status: string;
  hold_note: string;
  problem_category_id: string;
  problem_desc: string;
  follow_up: string;
};

export async function updateHeader(actor: Actor, id: number, f: HeaderInput) {
  return tx(async (c) => {
    const n = await draftForEdit(c, actor, id);
    const desc = f.problem_desc.trim();
    if (desc && (desc.length < 10 || desc.length > 2000)) throw new AppError("Uraian masalah needs 10 to 2,000 characters.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.inspect_date)) throw new AppError("Tanggal Periksa is not a valid date.");
    if (!/^\d{2}:\d{2}$/.test(f.inspect_time)) throw new AppError("Jam Periksa must be HH:MM.");
    if (n.receipt_date && f.inspect_date < n.receipt_date) throw new AppError("Tanggal Periksa cannot be before Tanggal Masuk.");
    if (f.inspect_date > wib().date) throw new AppError("Tanggal Periksa cannot be in the future.");
    const gs = f.goods_status || null;
    if (gs && !GOODS_STATUS[gs]) throw new AppError("Unknown status.");
    await c.query(
      `update ncf set inspect_date=$2, inspect_time=$3, goods_status=$4, hold_note=$5, problem_category_id=$6,
              problem_desc=$7, follow_up=$8 where id=$1`,
      [
        id,
        f.inspect_date,
        f.inspect_time,
        gs,
        gs === "HOLD" ? f.hold_note.trim() || null : null,
        f.problem_category_id ? Number(f.problem_category_id) : null,
        desc || null,
        f.follow_up.trim() || null,
      ],
    );
    await audit(c, { entity: "ncf", entityId: id, action: "EDIT_HEADER", actorType: "USER", actorId: actor.id });
  });
}

export async function addItem(actor: Actor, id: number, lineId: number, sample: unknown, defect: unknown, ret: unknown) {
  return tx(async (c) => {
    const n = await draftForEdit(c, actor, id);
    const line = await one<{ id: number; item_id: number; qty_received: number }>(
      c,
      `select l.id, l.item_id, l.qty_received from mrreg_line l join po_line pl on pl.id = l.po_line_id
       where l.id = $1 and l.mrreg_id = $2 and ($3::bigint is null or pl.po_id = $3)`,
      [lineId, n.mrreg_id, n.po_id],
    );
    if (!line) throw new AppError("Choose an item from this MRReg and PO.");
    const s = num(sample), d = num(defect), r = ret === "" || ret === undefined ? 0 : num(ret);
    if (!(s > 0 && s <= line.qty_received)) throw new AppError(`Jumlah Sample must be between 1 and ${line.qty_received}.`);
    if (!(d >= 1 && d <= s)) throw new AppError("Jumlah Cacat must be at least 1 and not more than Jumlah Sample.");
    if (!(r >= 0 && r <= line.qty_received)) throw new AppError(`Qty Retur must be between 0 and ${line.qty_received}.`);
    const dup = await one(c, "select 1 from ncf_item where ncf_id = $1 and mrreg_line_id = $2", [id, lineId]);
    if (dup) throw new AppError("This item is already on the NCF.");
    await c.query(
      `insert into ncf_item(ncf_id, mrreg_line_id, item_id, qty_received, qty_sample, qty_defect, qty_return)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, lineId, line.item_id, line.qty_received, s, d, r],
    );
    await audit(c, { entity: "ncf", entityId: id, action: "ADD_ITEM", newValue: String(lineId), actorType: "USER", actorId: actor.id });
  });
}

export async function removeItem(actor: Actor, id: number, itemId: number) {
  return tx(async (c) => {
    await draftForEdit(c, actor, id);
    await c.query("delete from ncf_item where id = $1 and ncf_id = $2", [itemId, id]);
    await audit(c, { entity: "ncf", entityId: id, action: "REMOVE_ITEM", oldValue: String(itemId), actorType: "USER", actorId: actor.id });
  });
}

export async function addEvidence(actor: Actor, id: number, files: File[], note: string) {
  return tx(async (c) => {
    await draftForEdit(c, actor, id);
    const count = await one<{ n: number }>(c, "select count(*)::int as n from evidence where ncf_id = $1 and kind <> 'NOTE'", [id]);
    if ((count?.n ?? 0) + files.length > LIMITS.filesPerNcf) throw new AppError(`At most ${LIMITS.filesPerNcf} files per NCF.`);
    for (const f of files) {
      const saved = await saveFile(c, f);
      await c.query("insert into evidence(ncf_id, file_id, kind, uploaded_by) values ($1,$2,$3,$4)", [id, saved.id, saved.kind, actor.id]);
    }
    if (note.trim()) {
      await c.query("insert into evidence(ncf_id, kind, caption, uploaded_by) values ($1,'NOTE',$2,$3)", [id, note.trim(), actor.id]);
    }
    await audit(c, { entity: "ncf", entityId: id, action: "ADD_EVIDENCE", newValue: String(files.length), actorType: "USER", actorId: actor.id });
  });
}

export async function removeEvidence(actor: Actor, id: number, evidenceId: number) {
  return tx(async (c) => {
    await draftForEdit(c, actor, id);
    await c.query("delete from evidence where id = $1 and ncf_id = $2", [evidenceId, id]);
    await audit(c, { entity: "ncf", entityId: id, action: "REMOVE_EVIDENCE", oldValue: String(evidenceId), actorType: "USER", actorId: actor.id });
  });
}

// ---------- Submit and sign (FD section 8) ----------

export function missingForSubmit(d: NcfDetail): string[] {
  const miss: string[] = [];
  if (!d.mrreg_id) miss.push("No. MRReg is not matched to SAP yet (Unmatched NCFs cannot be approved).");
  if (d.items.length === 0) miss.push("At least one item row.");
  if (!d.goods_status) miss.push("Status barang.");
  if (!d.problem_category_id) miss.push("Kategori masalah.");
  if (!d.problem_desc) miss.push("Uraian masalah.");
  if (!d.follow_up) miss.push("Tindak lanjut dari Integra.");
  if (!d.evidence.some((e) => e.file_id && e.capa_response_id === null)) miss.push("At least one evidence file.");
  if (d.goods_status === "FAILED" && d.items.reduce((t, i) => t + i.qty_return, 0) <= 0) {
    miss.push("Qty Retur, because the status is Gagal / Failed.");
  }
  return miss;
}

export async function submit(actor: Actor, id: number, password: string, now = new Date()) {
  return tx(async (c) => {
    const n = await draftForEdit(c, actor, id);
    await checkPassword(c, actor, password);
    const d = await loadDetails(c, n);
    const miss = missingForSubmit(d);
    if (miss.length) throw new AppError("Not complete: " + miss.join(" "));
    const chain = await q<{ step_no: number; approver_id: number | null; approver_title: string }>(
      c,
      "select step_no, approver_id, approver_title from approval_chain_step where bu_id = $1 order by step_no",
      [n.bu_id],
    );
    if (chain.length === 0 || chain.some((s) => !s.approver_id)) {
      throw new AppError("The approval chain for this Business Unit is not set up. Ask the Super Admin.", 409);
    }
    // Freeze SJ data from SAP at submit (FD section 6).
    const m = await one<{ sj_no: string; sj_date: string; receipt_date: string }>(
      c,
      "select sj_no, sj_date, receipt_date from mrreg where id = $1",
      [n.mrreg_id],
    );
    await c.query("update ncf set sj_no=$2, sj_date=$3, receipt_date=$4 where id=$1", [id, m!.sj_no, m!.sj_date, m!.receipt_date]);
    const snapshot = {
      ncf_no: n.ncf_no,
      bu: n.bu_name,
      supplier: { code: n.supplier_code, name: n.supplier_name },
      mrreg_no: n.mrreg_no,
      po_no: n.po_no,
      sj_no: m!.sj_no,
      sj_date: m!.sj_date,
      receipt_date: m!.receipt_date,
      inspect_date: n.inspect_date,
      inspect_time: n.inspect_time,
      goods_status: n.goods_status,
      hold_note: n.hold_note,
      problem_category: n.problem_category,
      problem_desc: n.problem_desc,
      follow_up: n.follow_up,
      items: d.items.map((i) => ({
        code: i.item_code, name: i.item_name, po: i.po_no, received: i.qty_received, sample: i.qty_sample, defect: i.qty_defect, ret: i.qty_return,
      })),
      evidence: d.evidence.filter((e) => e.capa_response_id === null).map((e) => ({ kind: e.kind, sha256: e.sha256, caption: e.caption })),
    };
    const versionNo = n.current_version + 1;
    const hash = sha256(canonicalJson(snapshot));
    const v = await one<{ id: number }>(
      c,
      `insert into ncf_version(ncf_id, version_no, content_hash, snapshot, submitted_by, submitted_at, verify_code)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [id, versionNo, hash, JSON.stringify(snapshot), actor.id, now, randomToken(12)],
    );
    // Step 0: the QC Inspector signs the content.
    await c.query(
      `insert into ncf_approval(ncf_version_id, step_no, approver_id, signer_name, signer_position, decision, decided_at, auth_method, verify_code)
       values ($1,0,$2,$3,$4,'APPROVED',$5,'PASSWORD',$6)`,
      [v!.id, actor.id, actor.name, actor.position ?? "QC Incoming", now, randomToken(12)],
    );
    for (const s of chain) {
      const u = await one<{ name: string; position: string | null }>(c, "select name, position from app_user where id = $1", [s.approver_id]);
      await c.query(
        `insert into ncf_approval(ncf_version_id, step_no, approver_id, signer_name, signer_position) values ($1,$2,$3,$4,$5)`,
        [v!.id, s.step_no, s.approver_id, u!.name, u!.position ?? s.approver_title],
      );
    }
    await c.query("update ncf set status='WAITING_APPROVAL', current_version=$2 where id=$1", [id, versionNo]);
    await audit(c, { entity: "ncf", entityId: id, action: "SUBMIT", field: "version", newValue: `${versionNo} ${hash}`, actorType: "USER", actorId: actor.id });
    const first = chain[0];
    await enqueue(c, {
      event: "NCF_SUBMITTED", refTable: "ncf", refId: id, toUserId: first.approver_id,
      subject: `NCF ${n.ncf_no} waits for your approval`,
      body: `${actor.name} submitted NCF ${n.ncf_no} (${n.supplier_name}). Open: ${appUrl()}/ncf/${id}`,
    });
    return versionNo;
  });
}

export type Decision = "APPROVED" | "RETURNED" | "REJECTED";

export async function decide(actor: Actor, id: number, decision: Decision, password: string, comment: string, now = new Date()) {
  return tx(async (c) => {
    const n = await lockNcf(c, id);
    expectStatus(n, "WAITING_APPROVAL");
    const pending = await one<{ id: number; step_no: number; approver_id: number; version_id: number }>(
      c,
      `select a.id, a.step_no, a.approver_id, v.id as version_id from ncf_approval a join ncf_version v on v.id = a.ncf_version_id
       where v.ncf_id = $1 and v.version_no = $2 and a.decision is null order by a.step_no limit 1`,
      [id, n.current_version],
    );
    if (!pending) throw new AppError("No approval step is open.", 409);
    if (pending.approver_id !== actor.id) throw new AppError("This step is assigned to another approver.", 403);
    if ((decision === "RETURNED" || decision === "REJECTED") && !comment.trim()) {
      throw new AppError("Write a comment to return or reject.");
    }
    await checkPassword(c, actor, password);
    await c.query(
      `update ncf_approval set decision=$2, comment=$3, decided_at=$4, auth_method='PASSWORD', signer_name=$5, signer_position=$6,
              verify_code = case when $2 = 'APPROVED' then $7 else null end
       where id=$1`,
      [pending.id, decision, comment.trim() || null, now, actor.name, actor.position ?? "Approver", randomToken(12)],
    );
    await audit(c, { entity: "ncf", entityId: id, action: `APPROVAL_${decision}`, field: `step ${pending.step_no}`, newValue: comment || null, actorType: "USER", actorId: actor.id });
    if (decision === "RETURNED") {
      await c.query("update ncf set status='DRAFT' where id=$1", [id]);
      await enqueue(c, {
        event: "NCF_RETURNED", refTable: "ncf", refId: id, toUserId: n.created_by,
        subject: `NCF ${n.ncf_no} was returned`, body: `${actor.name}: ${comment}\n${appUrl()}/ncf/${id}`,
      });
      return "DRAFT";
    }
    if (decision === "REJECTED") {
      await c.query("update ncf set status='VOID', void_reason=$2 where id=$1", [id, `Rejected by ${actor.name}: ${comment}`]);
      await enqueue(c, {
        event: "NCF_REJECTED", refTable: "ncf", refId: id, toUserId: n.created_by,
        subject: `NCF ${n.ncf_no} was rejected`, body: `${actor.name}: ${comment}`,
      });
      return "VOID";
    }
    const next = await one<{ approver_id: number }>(
      c,
      "select approver_id from ncf_approval where ncf_version_id = $1 and decision is null order by step_no limit 1",
      [pending.version_id],
    );
    if (next) {
      await enqueue(c, {
        event: "NCF_STEP_APPROVED", refTable: "ncf", refId: id, toUserId: next.approver_id,
        subject: `NCF ${n.ncf_no} waits for your approval`, body: `${appUrl()}/ncf/${id}`,
      });
      return "WAITING_APPROVAL";
    }
    await c.query("update ncf set status='APPROVED', approved_at=$2 where id=$1", [id, now]);
    for (const u of await usersWithRole(c, ["PURCHASING"])) {
      await enqueue(c, {
        event: "NCF_APPROVED", refTable: "ncf", refId: id, toUserId: u.id,
        subject: `NCF ${n.ncf_no} is approved and ready to send to ${n.supplier_name}`, body: `${appUrl()}/ncf/${id}`,
      });
    }
    // Read-only copies to PPIC and the QC Incoming archive (FD section 3) need their recipients named first.
    return "APPROVED";
  });
}

// ---------- Purchasing sends (FD section 10) ----------

async function issueToken(c: PoolClient, requestId: number, now: Date) {
  const days = await getSetting(c, "token_valid_days", now);
  const raw = randomToken();
  await c.query(
    "insert into access_token(request_id, token_hash, expires_at, created_at) values ($1,$2,$3,$4)",
    [requestId, sha256(raw), new Date(now.getTime() + days * 86400000), now],
  );
  return raw;
}

export const supplierLink = (raw: string) => `${appUrl()}/s/${raw}`;

export async function send(actor: Actor, id: number, method: "EMAIL" | "LINK", now = new Date()) {
  return tx(async (c) => {
    const n = await lockNcf(c, id);
    requireRole(actor, ["PURCHASING", "PCH_DIV_HEAD"]);
    expectStatus(n, "APPROVED");
    const contacts = await q<{ name: string; email: string }>(
      c,
      "select name, email from supplier_contact where supplier_id = $1 and active and is_ncf_recipient and email is not null",
      [n.supplier_id],
    );
    if (method === "EMAIL" && contacts.length === 0) {
      throw new AppError("This supplier has no email contact. Use Generate link and share it through another channel.", 409);
    }
    const req = await one<{ id: number }>(
      c,
      `insert into supplier_request(ref_no, type, supplier_id, ncf_id, status, send_method, sent_by, sent_at)
       values ($1,'NCF',$2,$3,'SENT',$4,$5,$6) returning id`,
      [`RQ-${n.ncf_no}`, n.supplier_id, id, method, actor.id, now],
    );
    const raw = await issueToken(c, req!.id, now);
    await c.query("update ncf set status='SENT' where id=$1", [id]);
    if (method === "EMAIL") {
      for (const ct of contacts) {
        await enqueue(c, {
          event: "NCF_SENT", refTable: "supplier_request", refId: req!.id, toEmail: ct.email,
          subject: `Non Conformity Form ${n.ncf_no} – Integra Group`,
          body:
            `Dear ${ct.name},\n\nIntegra Group found a non-conformity in your delivery SJ ${n.sj_no}. ` +
            `Please open the link below to read the NCF (Page 1, printable for your records) and submit your corrective and preventive action.\n\n` +
            `${supplierLink(raw)}\n\nRegards,\n${actor.name}, Purchasing`,
        });
      }
    }
    await audit(c, { entity: "ncf", entityId: id, action: "SEND", field: "method", newValue: method, actorType: "USER", actorId: actor.id });
    return { requestId: req!.id, link: supplierLink(raw) };
  });
}

/** A new link for the supplier. Earlier links stop working (FD section 10). */
export async function reissueLink(actor: Actor, id: number, now = new Date()) {
  return tx(async (c) => {
    const n = await lockNcf(c, id);
    requireRole(actor, ["PURCHASING", "PCH_DIV_HEAD"]);
    expectStatus(n, "SENT");
    const r = await one<{ id: number }>(c, "select id from supplier_request where ncf_id = $1", [id]);
    await c.query("update access_token set revoked_at = $2 where request_id = $1 and revoked_at is null", [r!.id, now]);
    const raw = await issueToken(c, r!.id, now);
    await audit(c, { entity: "ncf", entityId: id, action: "REISSUE_LINK", actorType: "USER", actorId: actor.id });
    return supplierLink(raw);
  });
}

// ---------- Verify and close (FD section 11) ----------

export async function close(actor: Actor, id: number, note: string, now = new Date()) {
  return tx(async (c) => {
    const n = await lockNcf(c, id);
    requireRole(actor, ["PURCHASING", "PCH_DIV_HEAD"]);
    expectStatus(n, "RESPONDED");
    if (note.trim().length < 5) throw new AppError("Write the verification result before closing.");
    const capa = await one<{ received_via: string; reviewed_at: Date | null }>(
      c,
      `select cr.received_via, cr.reviewed_at from capa_response cr join supplier_request r on r.id = cr.request_id
       where r.ncf_id = $1 and not cr.is_addendum`,
      [id],
    );
    if (capa?.received_via === "PURCHASING" && !capa.reviewed_at) {
      throw new AppError("Check and confirm the CAPA read from the supplier's reply before closing.", 409);
    }
    await c.query("update ncf set status='CLOSED', closed_at=$2, closed_by=$3, closure_note=$4 where id=$1", [id, now, actor.id, note.trim()]);
    await c.query("update supplier_request set status='CLOSED', closed_at=$2 where ncf_id=$1", [id, now]);
    await audit(c, { entity: "ncf", entityId: id, action: "CLOSE", newValue: note.trim(), actorType: "USER", actorId: actor.id });
    await enqueue(c, {
      event: "NCF_CLOSED", refTable: "ncf", refId: id, toUserId: n.created_by,
      subject: `NCF ${n.ncf_no} is closed`, body: note.trim(),
    });
    const contacts = await q<{ email: string }>(
      c,
      "select email from supplier_contact where supplier_id = $1 and active and is_ncf_recipient and email is not null",
      [n.supplier_id],
    );
    for (const ct of contacts) {
      await enqueue(c, {
        event: "NCF_CLOSED", refTable: "ncf", refId: id, toEmail: ct.email,
        subject: `NCF ${n.ncf_no} is closed – Integra Group`,
        body: `Thank you. Integra Group has verified your corrective and preventive action and closed NCF ${n.ncf_no}.`,
      });
    }
  });
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
