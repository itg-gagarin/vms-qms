// Who may do what: the roles, the signed-in person (Actor) and the checks every business rule calls.
// Roles are shared by all QMS modules; a new module adds its roles to Role and ROLES here.
import type { Db } from "./db";
import { one, q } from "./db";
import { AppError } from "./util";

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

/** Business Units the actor works in: null means all of them (a role without a unit, e.g. Purchasing or Super Admin). */
export function buScope(actor: Actor): number[] | null {
  if (actor.roles.some((r) => r.bu_id === null)) return null;
  return [...new Set(actor.roles.map((r) => r.bu_id as number))];
}

export function requireRole(actor: Actor, roles: Role | Role[], buId?: number | null) {
  if (!hasRole(actor, roles, buId)) throw new AppError("You do not have the role for this action.", 403);
}

/** The roles an administrator can give. `scoped` roles work in chosen Business Units; the others cover all units. */
export const ROLES: { role: Role; label: string; scoped: boolean }[] = [
  { role: "QC_INSPECTOR", label: "QC Inspector", scoped: true },
  { role: "NCF_APPROVER", label: "NCF Approver", scoped: true },
  { role: "PURCHASING", label: "Purchasing", scoped: false },
  { role: "PCH_DIV_HEAD", label: "PCH Div. Head", scoped: false },
  { role: "AUDITOR", label: "Auditor", scoped: false },
  { role: "SUPER_ADMIN", label: "Super Admin", scoped: false },
];

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

/**
 * The role a person mainly works in, for the shape of their screens (landing page, phone bar). Not an access check:
 * use hasRole for that. Super Admin, who counts as every role, is treated as an administrator here.
 */
export function primaryRole(actor: Actor): Role {
  const order: Role[] = ["QC_INSPECTOR", "NCF_APPROVER", "PURCHASING", "PCH_DIV_HEAD", "AUDITOR", "SUPER_ADMIN"];
  const held = new Set(actor.roles.map((r) => r.role));
  return order.find((r) => held.has(r)) ?? "AUDITOR";
}
