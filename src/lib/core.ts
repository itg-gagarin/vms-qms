// Small shared services: audit log, outbox, settings, working days, numbering, roles.
import type { Db } from "./db";
import { one, q } from "./db";
import type { NcfStatus } from "./labels";
import { AppError, romanMonth, wib } from "./util";

export type Role = "QC_INSPECTOR" | "NCF_APPROVER" | "PURCHASING" | "PCH_DIV_HEAD" | "AUDITOR" | "SUPER_ADMIN";

export type Actor = {
  id: number;
  name: string;
  position: string | null;
  email: string;
  roles: { role: Role; bu_id: number | null }[];
};

/**
 * Super Admin counts as every role, in every module, within its own Business Unit scope (null = all).
 * Signatures are not roles: an approval step names one person, and only that person can sign it.
 */
const grants = (r: Actor["roles"][number], list: Role[]) => r.role === "SUPER_ADMIN" || list.includes(r.role);

export function hasRole(actor: Actor, roles: Role | Role[], buId?: number | null) {
  const list = Array.isArray(roles) ? roles : [roles];
  return actor.roles.some(
    (r) => grants(r, list) && (r.bu_id === null || buId === undefined || buId === null || r.bu_id === buId),
  );
}

/** Business Units where the actor holds this role (null = all of them). Super Admin counts. */
export function roleScopes(actor: Actor, role: Role) {
  return actor.roles.filter((r) => grants(r, [role])).map((r) => r.bu_id);
}

export function requireRole(actor: Actor, roles: Role | Role[], buId?: number | null) {
  if (!hasRole(actor, roles, buId)) throw new AppError("You do not have the role for this action.", 403);
}

/**
 * Which NCF statuses each department works with. A user sees the union over their roles; Auditor and
 * Super Admin see every status. Lists, the detail page, prints, evidence files and the sidebar all read this.
 */
const ALL_STATUSES: NcfStatus[] = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "SENT", "RESPONDED", "CLOSED", "VOID"];
export const STATUSES_BY_ROLE: Record<Role, NcfStatus[]> = {
  QC_INSPECTOR: ["DRAFT", "WAITING_APPROVAL", "CLOSED", "VOID"],
  NCF_APPROVER: ["WAITING_APPROVAL", "APPROVED", "CLOSED", "VOID"],
  PURCHASING: ["APPROVED", "SENT", "RESPONDED", "CLOSED"],
  PCH_DIV_HEAD: ["APPROVED", "SENT", "RESPONDED", "CLOSED"],
  AUDITOR: ALL_STATUSES,
  SUPER_ADMIN: ALL_STATUSES,
};

/** NCF statuses this user may see, in workflow order. */
export function visibleStatuses(actor: Actor): NcfStatus[] {
  const mine = new Set(actor.roles.flatMap((r) => STATUSES_BY_ROLE[r.role] ?? []));
  return ALL_STATUSES.filter((s) => mine.has(s));
}

/** Internal users who may read an NCF of this BU in this status. */
export function canRead(actor: Actor, buId: number, status: NcfStatus) {
  if (!visibleStatuses(actor).includes(status)) return false;
  return hasRole(actor, ["QC_INSPECTOR", "NCF_APPROVER"], buId) ||
    hasRole(actor, ["PURCHASING", "PCH_DIV_HEAD", "AUDITOR", "SUPER_ADMIN"]);
}

export async function loadActor(db: Db, userId: number): Promise<Actor | undefined> {
  const u = await one<{ id: number; name: string; position: string | null; email: string }>(
    db,
    "select id, name, position, email from app_user where id = $1 and active",
    [userId],
  );
  if (!u) return undefined;
  const roles = await q<{ role: Role; bu_id: number | null }>(
    db,
    "select role, bu_id::int as bu_id from user_role where user_id = $1 and (valid_to is null or valid_to >= current_date)",
    [userId],
  );
  return { ...u, id: Number(u.id), roles };
}

type AuditInput = {
  entity: string;
  entityId: number;
  action: string;
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
  actorType: "USER" | "SUPPLIER" | "SYSTEM";
  actorId?: number | null;
};

export async function audit(db: Db, a: AuditInput) {
  await db.query(
    `insert into audit_log(entity, entity_id, action, field, old_value, new_value, actor_type, actor_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.entity, a.entityId, a.action, a.field ?? null, a.oldValue ?? null, a.newValue ?? null, a.actorType, a.actorId ?? null],
  );
}

type Mail = {
  event: string;
  refTable: string;
  refId: number;
  toEmail?: string | null;
  toUserId?: number | null;
  subject: string;
  body: string;
};

/** Queues an email in the same transaction as the change that caused it. */
export async function enqueue(db: Db, m: Mail) {
  await db.query(
    `insert into notification_outbox(event, ref_table, ref_id, recipient_email, recipient_user_id, template, payload)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [m.event, m.refTable, m.refId, m.toEmail ?? null, m.toUserId ?? null, m.event, JSON.stringify({ subject: m.subject, body: m.body })],
  );
}

export async function usersWithRole(db: Db, roles: Role[]) {
  return q<{ id: number; email: string; name: string }>(
    db,
    `select distinct u.id::int as id, u.email, u.name from app_user u join user_role r on r.user_id = u.id
     where r.role = any($1) and u.active and (r.valid_to is null or r.valid_to >= current_date)`,
    [roles],
  );
}

export async function getSetting(db: Db, key: string, at: Date = new Date()): Promise<number> {
  const row = await one<{ value: unknown }>(
    db,
    "select value from setting where key = $1 and valid_from <= $2 order by valid_from desc limit 1",
    [key, at],
  );
  if (!row) throw new AppError(`Setting ${key} is missing.`, 500);
  return Number(row.value);
}

/** Working days after the start date, up to and including the end date (WIB dates). */
export async function workingDaysBetween(db: Db, from: Date, to: Date): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    `select count(*)::int as n from calendar_day
     where is_working
       and day > ($1::timestamptz at time zone 'Asia/Jakarta')::date
       and day <= ($2::timestamptz at time zone 'Asia/Jakarta')::date`,
    [from, to],
  );
  return row?.n ?? 0;
}

/** Next No. Komplain, e.g. 424/XI/2026. The counter row is locked, so numbers never repeat. */
export async function nextNcfNo(db: Db, now = new Date()) {
  const { year, month } = wib(now);
  const key = `NCF-${year}`;
  const row = await one<{ last: number }>(
    db,
    `insert into doc_counter(key, last) values ($1, 1)
     on conflict (key) do update set last = doc_counter.last + 1
     returning last`,
    [key],
  );
  return `${row!.last}/${romanMonth(month)}/${year}`;
}
