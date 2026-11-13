// QR verification pages and print log (FD sections 9 and 13).
import type { Actor } from "./core";
import { canRead } from "./core";
import type { NcfStatus } from "./labels";
import { one, pool, q } from "./db";
import { AppError } from "./util";

export async function verifyDocument(code: string, viewer: Actor | null, ip: string | null) {
  const v = await one<{ id: number; ncf_id: number; version_no: number; content_hash: string; submitted_at: Date; current_version: number; bu_id: number }>(
    pool,
    `select v.id, v.ncf_id, v.version_no, v.content_hash, v.submitted_at, n.current_version, n.bu_id
     from ncf_version v join ncf n on n.id = v.ncf_id where v.verify_code = $1`,
    [code],
  );
  if (!v) throw new AppError("This QR code does not match any NCF record.", 404);
  await pool.query("insert into qr_scan(qr_type, ncf_version_id, user_id, ip) values ('DOCUMENT',$1,$2,$3)", [v.id, viewer?.id ?? null, ip]);
  const n = await one<{ ncf_no: string; status: string; supplier: string; bu: string; sj_no: string | null; receipt_date: string | null }>(
    pool,
    `select n.ncf_no, n.status, s.name as supplier, b.name as bu, n.sj_no, n.receipt_date
     from ncf n join supplier s on s.id = n.supplier_id join business_unit b on b.id = n.bu_id where n.id = $1`,
    [v.ncf_id],
  );
  const items = await q<{ item_code: string; item_name: string; qty_received: number; qty_sample: number; qty_defect: number; qty_return: number }>(
    pool,
    `select i.sap_material_code as item_code, i.description as item_name, ni.qty_received, ni.qty_sample, ni.qty_defect, ni.qty_return
     from ncf_item ni join item i on i.id = ni.item_id where ni.ncf_id = $1 order by ni.id`,
    [v.ncf_id],
  );
  const approvals = await q<{ step_no: number; signer_name: string; signer_position: string; decision: string | null; decided_at: Date | null }>(
    pool,
    "select step_no, signer_name, signer_position, decision, decided_at from ncf_approval where ncf_version_id = $1 order by step_no",
    [v.id],
  );
  const full = viewer ? canRead(viewer, v.bu_id, n!.status as NcfStatus) : false;
  return { ...v, ...n!, items, approvals, superseded: v.version_no !== v.current_version, canOpenFull: full };
}

export async function verifySignature(code: string, viewer: Actor | null, ip: string | null) {
  const a = await one<{
    id: number; step_no: number; signer_name: string; signer_position: string; decision: string; decided_at: Date; auth_method: string;
    version_no: number; content_hash: string; current_version: number; ncf_no: string; ncf_id: number; verify_code: string;
  }>(
    pool,
    `select a.id, a.step_no, a.signer_name, a.signer_position, a.decision, a.decided_at, a.auth_method,
            v.version_no, v.content_hash, n.current_version, n.ncf_no, n.id as ncf_id, v.verify_code
     from ncf_approval a join ncf_version v on v.id = a.ncf_version_id join ncf n on n.id = v.ncf_id
     where a.verify_code = $1 and a.decision = 'APPROVED'`,
    [code],
  );
  if (!a) throw new AppError("This signature QR does not match any approval record.", 404);
  await pool.query("insert into qr_scan(qr_type, ncf_approval_id, user_id, ip) values ('SIGNATURE',$1,$2,$3)", [a.id, viewer?.id ?? null, ip]);
  return { ...a, superseded: a.version_no !== a.current_version };
}

export async function logPrint(actor: Actor, ncfId: number, status: string) {
  const v = await one<{ id: number }>(
    pool,
    "select v.id from ncf_version v join ncf n on n.id = v.ncf_id and v.version_no = n.current_version where n.id = $1",
    [ncfId],
  );
  if (!v) return { kind: "DRAFT" as const, copy: 0 };
  const kind: "VOID" | "COPY" | "DRAFT" = status === "VOID" ? "VOID" : ["APPROVED", "SENT", "RESPONDED", "CLOSED"].includes(status) ? "COPY" : "DRAFT";
  await pool.query("insert into print_log(ncf_version_id, kind, printed_by) values ($1,$2,$3)", [v.id, kind, actor.id]);
  const n = await one<{ n: number }>(pool, "select count(*)::int as n from print_log where ncf_version_id = $1", [v.id]);
  return { kind, copy: n?.n ?? 1 };
}

// ---------- Settings and outbox (Super Admin) ----------
