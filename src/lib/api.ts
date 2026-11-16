// Read-only API for other Integra systems (the VMS): NCF rows and supplier responsiveness. Callers send an API key
// made in Master Settings, API keys. Only a SHA-256 of the key is stored; the key itself is shown once.
// Data scope: every Business Unit, every status except drafts (the API reads like an Auditor; drafts are QC's
// working copies). The figures come from the same queries as the Reports page.
import { randomBytes } from "node:crypto";
import { audit, requireRole, type Actor } from "./core";
import { one, pool, q, tx } from "./db";
import { isNcfStatus, type NcfStatus } from "./labels";
import { dashboard } from "./reports";
import { AppError, sha256 } from "./util";

// ---------- Keys (Super Admin) ----------

export async function listApiKeys(actor: Actor) {
  requireRole(actor, "SUPER_ADMIN");
  return q<{ id: number; name: string; prefix: string; created_at: Date; created_by: string; last_used_at: Date | null; revoked_at: Date | null }>(
    pool,
    `select k.id, k.name, k.prefix, k.created_at, u.name as created_by, k.last_used_at, k.revoked_at
     from api_key k join app_user u on u.id = k.created_by order by k.revoked_at nulls first, k.created_at desc`,
  );
}

/** Makes a key and returns it in full, once: "vms_<prefix>_<secret>". */
export async function createApiKey(actor: Actor, name: string) {
  requireRole(actor, "SUPER_ADMIN");
  const label = name.trim();
  if (label.length < 2) throw new AppError("Name the key after the system that uses it, e.g. VMS reports.");
  const prefix = randomBytes(4).toString("hex");
  const key = `vms_${prefix}_${randomBytes(24).toString("base64url")}`;
  return tx(async (c) => {
    const r = await one<{ id: number }>(c, "insert into api_key(name, prefix, key_hash, created_by) values ($1,$2,$3,$4) returning id",
      [label, prefix, sha256(key), actor.id]);
    await audit(c, { entity: "api_key", entityId: r!.id, action: "CREATE", newValue: `${label} (${prefix})`, actorType: "USER", actorId: actor.id });
    return key;
  });
}

export async function revokeApiKey(actor: Actor, id: number) {
  requireRole(actor, "SUPER_ADMIN");
  return tx(async (c) => {
    const r = await c.query("update api_key set revoked_at = now() where id = $1 and revoked_at is null", [id]);
    if (!r.rowCount) throw new AppError("Key not found or already revoked.", 404);
    await audit(c, { entity: "api_key", entityId: id, action: "REVOKE", actorType: "USER", actorId: actor.id });
  });
}

/** The key from "Authorization: Bearer …" or "X-API-Key", checked against the stored hashes. */
export async function checkApiKey(req: Request) {
  const raw = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const m = /^vms_([0-9a-f]{8})_[A-Za-z0-9_-]{20,}$/.exec(raw.trim());
  if (!m) return null;
  const k = await one<{ id: number; key_hash: string }>(pool, "select id, key_hash from api_key where prefix = $1 and revoked_at is null", [m[1]]);
  if (!k || k.key_hash !== sha256(raw.trim())) return null;
  await pool.query("update api_key set last_used_at = now() where id = $1", [k.id]);
  return k.id;
}

// ---------- Data ----------

/** Reads like an Auditor (all units, all stages); never writes. */
const reader: Actor = { id: 0, name: "API", position: null, email: "api@vms", roles: [{ role: "AUDITOR", bu_id: null }] };

export type ApiFilter = { from: string; to: string; status?: NcfStatus; supplier?: string; bu?: string; page: number; size: number };

export function parseFilter(p: URLSearchParams): ApiFilter {
  const year = new Date().getUTCFullYear();
  const date = (v: string | null, d: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
  const status = p.get("status");
  if (status && !isNcfStatus(status)) throw new AppError("status: one of DRAFT, WAITING_APPROVAL, APPROVED, SENT, RESPONDED, CLOSED, VOID.");
  const size = Math.min(500, Math.max(1, Number(p.get("size")) || 100));
  return {
    from: date(p.get("from"), `${year}-01-01`), to: date(p.get("to"), `${year}-12-31`), status: (status as NcfStatus) || undefined,
    supplier: p.get("supplier")?.trim() || undefined, bu: p.get("bu")?.trim() || undefined,
    page: Math.max(1, Math.floor(Number(p.get("page")) || 1)), size,
  };
}

/** NCF rows with their items and the timestamps behind every response figure. Period = date raised (WIB). */
export async function apiNcfs(f: ApiFilter) {
  const where = `n.status <> 'DRAFT' and (n.created_at at time zone 'Asia/Jakarta')::date between $1 and $2
    and ($3::text is null or n.status = $3) and ($4::text is null or s.sap_vendor_code = $4) and ($5::text is null or b.code = $5)`;
  const params = [f.from, f.to, f.status ?? null, f.supplier ?? null, f.bu ?? null];
  const from = `from ncf n join supplier s on s.id = n.supplier_id join business_unit b on b.id = n.bu_id
    left join mrreg m on m.id = n.mrreg_id left join purchase_order po on po.id = n.po_id
    left join problem_category pc on pc.id = n.problem_category_id left join supplier_request r on r.ncf_id = n.id`;
  const [rows, total] = await Promise.all([
    q(pool,
      `select n.id, n.ncf_no, n.status, b.code as business_unit, s.sap_vendor_code as supplier_code, s.name as supplier_name,
              m.mrreg_no, po.po_no, n.sj_no, n.sj_date, n.receipt_date, n.inspect_date, n.goods_status, pc.name as problem_category,
              n.problem_desc, n.follow_up, n.current_version as version,
              n.created_at, (select min(v.submitted_at) from ncf_version v where v.ncf_id = n.id) as submitted_at, n.approved_at,
              r.sent_at, r.responded_at, n.closed_at,
              case when n.approved_at is not null then working_days_between((select min(v.submitted_at) from ncf_version v where v.ncf_id = n.id), n.approved_at) end as approval_working_days,
              case when r.sent_at is not null then working_days_between(n.approved_at, r.sent_at) end as send_working_days,
              coalesce(r.response_working_days, case when r.sent_at is not null and r.responded_at is null then working_days_between(r.sent_at, now()) end) as response_working_days,
              (r.sent_at is not null and r.responded_at is null) as waiting_for_supplier,
              coalesce((select json_agg(json_build_object('item_code', i.sap_material_code, 'item_name', i.description, 'qty_received', ni.qty_received::float,
                          'qty_sample', ni.qty_sample::float, 'qty_defect', ni.qty_defect::float, 'qty_return', ni.qty_return::float) order by ni.id)
                        from ncf_item ni join item i on i.id = ni.item_id where ni.ncf_id = n.id), '[]') as items
       ${from} where ${where} order by n.created_at desc, n.id desc limit ${f.size} offset ${(f.page - 1) * f.size}`, params),
    one<{ n: number }>(pool, `select count(*)::int as n ${from} where ${where}`, params),
  ]);
  return { data: rows, page: f.page, size: f.size, total: total?.n ?? 0 };
}

/** Supplier responsiveness and the summary figures, exactly as the Reports page computes them. */
export async function apiResponsiveness(f: ApiFilter) {
  const bu = f.bu ? (await one<{ id: number }>(pool, "select id from business_unit where code = $1", [f.bu]))?.id : undefined;
  if (f.bu && !bu) throw new AppError(`bu: no business unit with code ${f.bu}.`);
  const supplierId = f.supplier ? (await one<{ id: number }>(pool, "select id from supplier where sap_vendor_code = $1", [f.supplier]))?.id : undefined;
  if (f.supplier && !supplierId) throw new AppError(`supplier: no supplier with vendor code ${f.supplier}.`);
  const d = await dashboard(reader, { from: f.from, to: f.to, status: f.status, supplierId, buId: bu });
  return {
    period: { from: f.from, to: f.to }, target_working_days: d.target, summary: d.kpi,
    suppliers: d.suppliers, monthly: d.monthly, by_status: d.byStatus, by_category: d.categories,
  };
}
