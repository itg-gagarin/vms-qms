// Supplier Master: the vendors from SAP, their contacts for NCFs, and how each one has responded.
// Purchasing and PCH Div. Head own it (Super Admin counts as every role). Vendors normally arrive with the SAP
// export (import-mrreg upserts them by vendor code); adding one here is for a vendor not in an export yet.
import type { PoolClient } from "pg";
import { audit, requireRole, visibleStatuses, type Actor, type Role } from "./core";
import { one, pool, q, tx } from "./db";
import type { NcfStatus } from "./labels";
import { AppError } from "./util";

export const SUPPLIER_ROLES: Role[] = ["PURCHASING", "PCH_DIV_HEAD"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** SAP vendor codes in the export: three letters and five digits (e.g. VLP00412). Other codes are allowed but must be plain. */
const CODE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;

const log = (c: PoolClient, actor: Actor, id: number, action: string, field: string | null, newValue: string | null) =>
  audit(c, { entity: "supplier", entityId: id, action, field: field ?? undefined, newValue, actorType: "USER", actorId: actor.id });

export type SupplierRow = {
  id: number; code: string; name: string; status: string; contacts: number; email: string | null; phone: string | null;
  ncfs: number; open_ncfs: number; avg_wd: number | null; last_ncf: Date | null;
};

function listWhere(term: string) {
  return {
    sql: `($1 = '' or s.name ilike '%' || $1 || '%' or s.sap_vendor_code ilike '%' || $1 || '%'
           or exists (select 1 from supplier_contact c where c.supplier_id = s.id and (c.name ilike '%' || $1 || '%' or c.email ilike '%' || $1 || '%')))`,
    params: [term.trim()],
  };
}

/** One page of suppliers: those with NCFs first (most recent first), then by name. */
export async function listSuppliers(actor: Actor, term: string, page = 1, size = 20) {
  requireRole(actor, SUPPLIER_ROLES);
  const w = listWhere(term);
  const [rows, total] = await Promise.all([
    q<SupplierRow>(
      pool,
      `select s.id, s.sap_vendor_code as code, s.name, s.status,
              (select count(*)::int from supplier_contact c where c.supplier_id = s.id and c.active) as contacts,
              (select c.email from supplier_contact c where c.supplier_id = s.id and c.active and c.email is not null order by c.is_ncf_recipient desc, c.id limit 1) as email,
              (select c.phone from supplier_contact c where c.supplier_id = s.id and c.active and c.phone is not null order by c.is_ncf_recipient desc, c.id limit 1) as phone,
              (select count(*)::int from ncf n where n.supplier_id = s.id and n.status not in ('DRAFT','VOID')) as ncfs,
              (select count(*)::int from ncf n where n.supplier_id = s.id and n.status in ('APPROVED','SENT','RESPONDED')) as open_ncfs,
              (select round(avg(r.response_working_days), 1)::float from supplier_request r where r.supplier_id = s.id and r.response_working_days is not null) as avg_wd,
              (select max(n.created_at) from ncf n where n.supplier_id = s.id and n.status <> 'VOID') as last_ncf
       from supplier s where ${w.sql}
       order by (select max(n.created_at) from ncf n where n.supplier_id = s.id) desc nulls last, s.name
       limit ${Number(size)} offset ${(Number(page) - 1) * Number(size)}`,
      w.params,
    ),
    one<{ n: number }>(pool, `select count(*)::int as n from supplier s where ${w.sql}`, w.params),
  ]);
  return { rows, total: total?.n ?? 0 };
}

/** The supplier page: master data, contacts, response figures and the NCFs the user's department may see. */
export async function getSupplier(actor: Actor, id: number) {
  requireRole(actor, SUPPLIER_ROLES);
  const s = await one<{ id: number; code: string; name: string; status: string }>(
    pool, "select id, sap_vendor_code as code, name, status from supplier where id = $1", [id],
  );
  if (!s) throw new AppError("Supplier not found.", 404);
  const seen = visibleStatuses(actor);
  const [contacts, stats, ncfs] = await Promise.all([
    q<{ id: number; name: string; email: string | null; phone: string | null; active: boolean; ncf: boolean }>(
      pool, "select id, name, email, phone, active, is_ncf_recipient as ncf from supplier_contact where supplier_id = $1 order by active desc, id", [id],
    ),
    one<{ ncfs: number; replied: number; waiting: number; avg_wd: number | null; max_wd: number | null; receipts: number }>(
      pool,
      `select (select count(*)::int from ncf n where n.supplier_id = $1 and n.status not in ('DRAFT','VOID')) as ncfs,
              (select count(*)::int from supplier_request r where r.supplier_id = $1 and r.responded_at is not null) as replied,
              (select count(*)::int from supplier_request r where r.supplier_id = $1 and r.sent_at is not null and r.responded_at is null) as waiting,
              (select round(avg(r.response_working_days), 1)::float from supplier_request r where r.supplier_id = $1 and r.response_working_days is not null) as avg_wd,
              (select max(r.response_working_days)::int from supplier_request r where r.supplier_id = $1) as max_wd,
              (select count(*)::int from mrreg m where m.supplier_id = $1) as receipts`,
      [id],
    ),
    q<{ id: number; ncf_no: string; status: NcfStatus; created_at: Date; po_no: string | null; sent_at: Date | null; response_working_days: number | null }>(
      pool,
      `select n.id, n.ncf_no, n.status, n.created_at, po.po_no, r.sent_at, r.response_working_days
       from ncf n left join purchase_order po on po.id = n.po_id left join supplier_request r on r.ncf_id = n.id
       where n.supplier_id = $1 and n.status = any($2) order by n.created_at desc limit 50`,
      [id, seen],
    ),
  ]);
  return { ...s, contacts, stats: stats!, ncfs };
}

/** A vendor not in an SAP export yet. The SAP vendor code is the key the export will match later. */
export async function createSupplier(actor: Actor, f: { code: string; name: string }) {
  requireRole(actor, SUPPLIER_ROLES);
  const code = f.code.trim().toUpperCase(), name = f.name.trim();
  if (!CODE.test(code)) throw new AppError("Vendor code: letters and digits as in SAP, e.g. VLP00412.");
  if (name.length < 2) throw new AppError("Supplier name is required.");
  return tx(async (c) => {
    if (await one(c, "select 1 from supplier where sap_vendor_code = $1", [code])) throw new AppError(`Vendor code ${code} already exists.`);
    const r = await one<{ id: number }>(c, "insert into supplier(sap_vendor_code, name) values ($1,$2) returning id", [code, name]);
    await log(c, actor, r!.id, "CREATE_SUPPLIER", null, `${code} ${name}`);
    return r!.id;
  });
}

/** Rename a supplier (the vendor code stays: it is SAP's key). */
export async function renameSupplier(actor: Actor, id: number, name: string) {
  requireRole(actor, SUPPLIER_ROLES);
  const v = name.trim();
  if (v.length < 2) throw new AppError("Supplier name is required.");
  return tx(async (c) => {
    const old = await one<{ name: string }>(c, "select name from supplier where id = $1 for update", [id]);
    if (!old) throw new AppError("Supplier not found.", 404);
    if (old.name === v) return;
    await c.query("update supplier set name = $2 where id = $1", [id, v]);
    await log(c, actor, id, "RENAME_SUPPLIER", "name", v);
  });
}

/** Add or change a contact. NCF recipients are the people Purchasing emails the exported form to. */
export async function saveContact(actor: Actor, f: { id: number | null; supplierId: number; name: string; email: string; phone: string; active: boolean; ncf: boolean }) {
  requireRole(actor, SUPPLIER_ROLES);
  const name = f.name.trim(), email = f.email.trim().toLowerCase() || null, phone = f.phone.trim() || null;
  if (!name) throw new AppError("Contact name is required.");
  if (email && !EMAIL.test(email)) throw new AppError("Email is not valid.");
  if (!email && !phone) throw new AppError("Give an email or a phone number.");
  return tx(async (c) => {
    if (!(await one(c, "select 1 from supplier where id = $1", [f.supplierId]))) throw new AppError("Supplier not found.", 404);
    if (f.id) {
      const r = await c.query(
        "update supplier_contact set name=$2, email=$3, phone=$4, active=$5, is_ncf_recipient=$6 where id=$1 and supplier_id=$7",
        [f.id, name, email, phone, f.active, f.ncf, f.supplierId],
      );
      if (!r.rowCount) throw new AppError("Contact not found.", 404);
      await log(c, actor, f.supplierId, "EDIT_CONTACT", "contact", `${name} ${email ?? ""} ${phone ?? ""} active=${f.active} ncf=${f.ncf}`);
      return f.id;
    }
    const r = await one<{ id: number }>(
      c, "insert into supplier_contact(supplier_id, name, email, phone, active, is_ncf_recipient) values ($1,$2,$3,$4,true,$5) returning id",
      [f.supplierId, name, email, phone, f.ncf],
    );
    await log(c, actor, f.supplierId, "ADD_CONTACT", "contact", `${name} ${email ?? ""} ${phone ?? ""}`);
    return r!.id;
  });
}
