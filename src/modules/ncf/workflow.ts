// The NCF workflow (FD sections 4 to 11): draft, items and evidence, sign and submit, approve in order, send,
// close. Every function checks the person's role and the NCF status itself, so screens cannot bypass a rule.
import type { PoolClient } from "pg";
import { requireRole, type Actor } from "@/platform/access";
import { audit } from "@/platform/audit";
import { one, q, tx } from "@/platform/db";
import { LIMITS, saveFile } from "@/platform/files";
import { enqueue, usersWithRole } from "@/platform/outbox";
import { checkPassword } from "@/platform/signature";
import { AppError, appUrl, canonicalJson, num, randomToken, sha256, wib } from "@/platform/util";
import { GOODS_STATUS } from "./labels";
import { nextNumber } from "./numbering";
import { expectStatus, loadDetails, lockNcf, type NcfDetail } from "./records";

// ---------- Draft (Part 1) ----------

/** A new draft for an MRReg. With a single PO it is filled in; with several, QC chooses it in the draft (setPo). */
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

/** QC chooses or changes the draft's PO. Not while items from another PO are on it: they would not match the PO. */
export async function setPo(actor: Actor, id: number, poId: number) {
  return tx(async (c) => {
    const n = await draftForEdit(c, actor, id);
    if (n.po_id === poId) return;
    const po = await one<{ po_no: string }>(
      c,
      `select distinct po.po_no from mrreg_line l join po_line pl on pl.id = l.po_line_id join purchase_order po on po.id = pl.po_id
       where l.mrreg_id = $1 and po.id = $2`,
      [n.mrreg_id, poId],
    );
    if (!po) throw new AppError("This PO is not on the MRReg.");
    const other = await one<{ n: number }>(c, "select count(*)::int as n from ncf_item where ncf_id = $1", [id]);
    if (other!.n > 0) throw new AppError(`Remove the ${other!.n} item(s) of PO ${n.po_no} first, then change the PO.`);
    await c.query("update ncf set po_id = $2 where id = $1", [id, poId]);
    await audit(c, { entity: "ncf", entityId: id, action: "SET_PO", field: "po", oldValue: n.po_no, newValue: po.po_no, actorType: "USER", actorId: actor.id });
  });
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
    if (!n.po_id) throw new AppError("Choose the PO first (section A).");
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

/** The draft form's cards: A identification, B items, C status, D problem, E evidence, F follow-up. */
export type DraftPart = "A" | "B" | "C" | "D" | "E" | "F";
export type Missing = { part: DraftPart; text: string };

/** What still blocks submitting, with the card it belongs to so the form can point at it. */
export function missingParts(d: NcfDetail): Missing[] {
  const miss: Missing[] = [];
  if (!d.mrreg_id) miss.push({ part: "A", text: "No. MRReg is not matched to SAP yet (Unmatched NCFs cannot be approved)." });
  if (!d.po_id) miss.push({ part: "A", text: "No. PO." });
  if (d.items.length === 0) miss.push({ part: "B", text: "At least one item row." });
  if (d.goods_status === "FAILED" && d.items.length > 0 && d.items.reduce((t, i) => t + i.qty_return, 0) <= 0) {
    miss.push({ part: "B", text: "Qty Retur, because the status is Gagal / Failed." });
  }
  if (!d.goods_status) miss.push({ part: "C", text: "Status barang." });
  if (!d.problem_category_id) miss.push({ part: "D", text: "Kategori masalah." });
  if (!d.problem_desc) miss.push({ part: "D", text: "Uraian masalah." });
  if (!d.evidence.some((e) => e.file_id && e.capa_response_id === null)) miss.push({ part: "E", text: "At least one evidence file." });
  if (!d.follow_up) miss.push({ part: "F", text: "Tindak lanjut dari Integra." });
  return miss;
}

export function missingForSubmit(d: NcfDetail): string[] {
  return missingParts(d).map((m) => m.text);
}

/** Submitting an incomplete draft. Carries the cards to highlight. */
export class IncompleteError extends AppError {
  constructor(public missing: Missing[]) {
    super("Not complete: " + missing.map((m) => m.text).join(" "));
  }
}

export async function submit(actor: Actor, id: number, password: string, now = new Date()) {
  return tx(async (c) => {
    const n = await draftForEdit(c, actor, id);
    const d = await loadDetails(c, n);
    const miss = missingParts(d);
    if (miss.length) throw new IncompleteError(miss);
    await checkPassword(c, actor, password);
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
// No link to the system leaves Integra: Purchasing exports the form as PDF, emails it from their own mailbox,
// and records when it went out. That time starts the supplier's response clock.

/** Purchasing sent the exported form to the supplier at `sentAt`. Starts the response clock. */
export async function markSent(actor: Actor, id: number, sentAt: Date, now = new Date()) {
  return tx(async (c) => {
    const n = await lockNcf(c, id);
    requireRole(actor, ["PURCHASING", "PCH_DIV_HEAD"]);
    expectStatus(n, "APPROVED");
    if (sentAt.getTime() > now.getTime() + 60_000) throw new AppError("Sent at cannot be in the future.");
    if (n.approved_at && sentAt.getTime() < Math.floor(n.approved_at.getTime() / 60_000) * 60_000) {
      throw new AppError("The form cannot be sent before the NCF was approved.");
    }
    const req = await one<{ id: number }>(
      c,
      `insert into supplier_request(ref_no, type, supplier_id, ncf_id, status, send_method, sent_by, sent_at)
       values ($1,'NCF',$2,$3,'SENT','EMAIL',$4,$5) returning id`,
      [`RQ-${n.ncf_no}`, n.supplier_id, id, actor.id, sentAt],
    );
    await c.query("update ncf set status='SENT' where id=$1", [id]);
    await audit(c, { entity: "ncf", entityId: id, action: "SENT", field: "sent_at", newValue: sentAt.toISOString(), actorType: "USER", actorId: actor.id });
    return { requestId: req!.id };
  });
}

// ---------- Verify and close (FD section 11) ----------

/** Closing records that Purchasing checked the supplier's reply. No verification note: the reply is kept as received. */
export async function close(actor: Actor, id: number, now = new Date()) {
  return tx(async (c) => {
    const n = await lockNcf(c, id);
    requireRole(actor, ["PURCHASING", "PCH_DIV_HEAD"]);
    expectStatus(n, "RESPONDED");
    await c.query("update ncf set status='CLOSED', closed_at=$2, closed_by=$3 where id=$1", [id, now, actor.id]);
    await c.query("update supplier_request set status='CLOSED', closed_at=$2 where ncf_id=$1", [id, now]);
    await audit(c, { entity: "ncf", entityId: id, action: "CLOSE", actorType: "USER", actorId: actor.id });
    await enqueue(c, {
      event: "NCF_CLOSED", refTable: "ncf", refId: id, toUserId: n.created_by,
      subject: `NCF ${n.ncf_no} is closed`, body: `NCF ${n.ncf_no} was verified and closed.`,
    });
  });
}
