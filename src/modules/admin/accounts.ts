// Master Settings, accounts: people, their roles per Business Unit, and the job positions printed under signatures.
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { ROLES, type Actor, type Role } from "@/platform/access";
import { one, pool, q, tx } from "@/platform/db";
import { AppError } from "@/platform/util";
import { admin, EMAIL, log } from "./common";

// ---------- Accounts ----------

export async function listUsers(actor: Actor) {
  admin(actor);
  return q<{
    id: number; name: string; position: string | null; email: string; active: boolean; created_at: Date; has_password: boolean;
    roles: { id: number; role: Role; bu_id: number | null; bu: string | null; valid_to: string | null }[];
  }>(
    pool,
    `select u.id, u.name, u.position, u.email, u.active, u.created_at, (u.password_hash is not null) as has_password,
            coalesce((select json_agg(json_build_object('id', r.id, 'role', r.role, 'bu_id', r.bu_id, 'bu', b.code, 'valid_to', r.valid_to) order by r.role)
                      from user_role r left join business_unit b on b.id = r.bu_id where r.user_id = u.id), '[]') as roles
     from app_user u order by u.active desc, u.name`,
  );
}

export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];

/** One account with its roles, for the account page. */
export async function getUser(actor: Actor, id: number) {
  const u = (await listUsers(actor)).find((x) => x.id === id);
  if (!u) throw new AppError("Account not found.", 404);
  return u;
}

/** The position must come from the list (Master Settings, Positions); empty is allowed. */
async function checkPosition(c: PoolClient, position: string | null, current?: string | null) {
  if (!position || position === current) return;
  if (!(await one(c, "select 1 from job_position where name = $1 and active", [position]))) {
    throw new AppError("Choose a position from the list. New positions are added in Master Settings, Positions.");
  }
}

function checkPassword(pw: string) {
  if (pw.length < 8) throw new AppError("The password needs at least 8 characters.");
}

export async function createUser(actor: Actor, f: { name: string; position: string; email: string; password: string }) {
  admin(actor);
  const name = f.name.trim(), email = f.email.trim().toLowerCase();
  if (!name) throw new AppError("Name is required.");
  if (!EMAIL.test(email)) throw new AppError("Email is not valid.");
  checkPassword(f.password);
  return tx(async (c) => {
    await checkPosition(c, f.position.trim() || null);
    if (await one(c, "select 1 from app_user where lower(email) = $1", [email])) throw new AppError("An account with this email exists.");
    const u = await one<{ id: number }>(
      c, "insert into app_user(name, position, email, password_hash) values ($1,$2,$3,$4) returning id",
      [name, f.position.trim() || null, email, await bcrypt.hash(f.password, 10)],
    );
    await log(c, actor, "app_user", u!.id, "CREATE", "email", null, email);
    return u!.id;
  });
}

export async function updateUser(actor: Actor, id: number, f: { name: string; position: string; email: string }) {
  admin(actor);
  const name = f.name.trim(), email = f.email.trim().toLowerCase(), position = f.position.trim() || null;
  if (!name) throw new AppError("Name is required.");
  if (!EMAIL.test(email)) throw new AppError("Email is not valid.");
  return tx(async (c) => {
    const cur = await one<{ name: string; position: string | null; email: string }>(c, "select name, position, email from app_user where id = $1 for update", [id]);
    if (!cur) throw new AppError("Account not found.", 404);
    await checkPosition(c, position, cur.position);
    if (email !== cur.email && (await one(c, "select 1 from app_user where lower(email) = $1 and id <> $2", [email, id]))) {
      throw new AppError("Another account uses this email.");
    }
    await c.query("update app_user set name = $2, position = $3, email = $4 where id = $1", [id, name, position, email]);
    for (const [k, a, b] of [["name", cur.name, name], ["position", cur.position, position], ["email", cur.email, email]] as const) {
      if (a !== b) await log(c, actor, "app_user", id, "EDIT", k, a, b);
    }
  });
}

export async function resetPassword(actor: Actor, id: number, password: string) {
  admin(actor);
  checkPassword(password);
  return tx(async (c) => {
    const r = await c.query("update app_user set password_hash = $2 where id = $1", [id, await bcrypt.hash(password, 10)]);
    if (!r.rowCount) throw new AppError("Account not found.", 404);
    await log(c, actor, "app_user", id, "RESET_PASSWORD");
  });
}

const superAdmins = (c: PoolClient, exceptUser?: number, exceptRole?: number) =>
  one<{ n: number }>(
    c,
    `select count(*)::int as n from user_role r join app_user u on u.id = r.user_id
     where r.role = 'SUPER_ADMIN' and u.active and (r.valid_to is null or r.valid_to >= current_date)
       and ($1::bigint is null or u.id <> $1) and ($2::bigint is null or r.id <> $2)`,
    [exceptUser ?? null, exceptRole ?? null],
  );

/** Deactivating keeps the account and its history; signatures and records stay attributed to it. */
export async function setActive(actor: Actor, id: number, active: boolean) {
  admin(actor);
  return tx(async (c) => {
    if (!active) {
      if (id === actor.id) throw new AppError("You cannot deactivate your own account.");
      if ((await superAdmins(c, id))!.n === 0) throw new AppError("Keep at least one active Super Admin.");
      const chain = await q<{ code: string; step_no: number }>(
        c, "select b.code, s.step_no from approval_chain_step s join business_unit b on b.id = s.bu_id where s.approver_id = $1", [id],
      );
      if (chain.length) throw new AppError(`Replace this person in the approval chain first (${chain.map((s) => `${s.code} step ${s.step_no}`).join(", ")}).`);
      const waiting = await one<{ n: number }>(
        c,
        `select count(*)::int as n from ncf_approval a join ncf_version v on v.id = a.ncf_version_id join ncf n on n.id = v.ncf_id
         where a.approver_id = $1 and a.decision is null and n.status = 'WAITING_APPROVAL' and v.version_no = n.current_version`,
        [id],
      );
      if (waiting!.n) throw new AppError(`This person has ${waiting!.n} approval(s) waiting. They must be decided first.`);
    }
    const r = await c.query("update app_user set active = $2 where id = $1", [id, active]);
    if (!r.rowCount) throw new AppError("Account not found.", 404);
    await log(c, actor, "app_user", id, active ? "ACTIVATE" : "DEACTIVATE");
  });
}

export async function addRole(actor: Actor, userId: number, role: Role, buId: number | null, validTo: string | null) {
  admin(actor);
  const def = ROLES.find((r) => r.role === role);
  if (!def) throw new AppError("Unknown role.");
  // QC and approvers can be limited to one unit (or all units, chosen on purpose); other roles always cover all units.
  if (!def.scoped) buId = null;
  if (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) throw new AppError("End date is not a valid date.");
  return tx(async (c) => {
    if (await one(c, "select 1 from user_role where user_id = $1 and role = $2 and coalesce(bu_id, 0) = coalesce($3::bigint, 0)", [userId, role, buId])) {
      throw new AppError("This person already has that role there.");
    }
    await c.query("insert into user_role(user_id, role, bu_id, valid_to) values ($1,$2,$3,$4)", [userId, role, buId, validTo]);
    await log(c, actor, "app_user", userId, "ADD_ROLE", "role", null, `${role}${buId ? ` @${buId}` : ""}${validTo ? ` until ${validTo}` : ""}`);
  });
}

/**
 * Gives a role in one or several Business Units at once (e.g. a QC inspector who works for two units); null in
 * buIds means all units. Roles that are not unit-scoped always cover all units.
 */
export async function addRoles(actor: Actor, userId: number, role: Role, buIds: (number | null)[], validTo: string | null) {
  admin(actor);
  const def = ROLES.find((r) => r.role === role);
  if (!def) throw new AppError("Choose a role.");
  const targets = !def.scoped ? [null] : buIds.includes(null) ? [null] : [...new Set(buIds)];
  if (targets.length === 0) throw new AppError("Choose at least one business unit, or All units.");
  let added = 0;
  for (const bu of targets) {
    try {
      await addRole(actor, userId, role, bu, validTo);
      added++;
    } catch (e) {
      if (!(e instanceof AppError && /already has/.test(e.message))) throw e;
    }
  }
  if (!added) throw new AppError("This person already has that role in the chosen units.");
  return added;
}

// ---------- Job positions ----------

export async function listPositions(activeOnly = false) {
  return q<{ id: number; name: string; active: boolean; users: number }>(
    pool,
    `select p.id, p.name, p.active, (select count(*)::int from app_user u where u.position = p.name and u.active) as users
     from job_position p where not $1 or p.active order by p.active desc, p.name`,
    [activeOnly],
  );
}

/** Adds or renames a position. Renaming also updates the accounts that hold it; signatures already given keep the old text. */
export async function savePosition(actor: Actor, id: number | null, name: string, active: boolean) {
  admin(actor);
  const v = name.trim();
  if (v.length < 2) throw new AppError("Position name is required.");
  return tx(async (c) => {
    if (await one(c, "select 1 from job_position where lower(name) = lower($1) and id <> coalesce($2::bigint, 0)", [v, id])) {
      throw new AppError("That position exists already.");
    }
    if (!id) {
      const r = await one<{ id: number }>(c, "insert into job_position(name) values ($1) returning id", [v]);
      await log(c, actor, "job_position", r!.id, "CREATE", "name", null, v);
      return r!.id;
    }
    const cur = await one<{ name: string; active: boolean }>(c, "select name, active from job_position where id = $1 for update", [id]);
    if (!cur) throw new AppError("Position not found.", 404);
    await c.query("update job_position set name = $2, active = $3 where id = $1", [id, v, active]);
    if (cur.name !== v) {
      await c.query("update app_user set position = $2 where position = $1", [cur.name, v]);
      await log(c, actor, "job_position", id, "RENAME", "name", cur.name, v);
    }
    if (cur.active !== active) await log(c, actor, "job_position", id, active ? "ACTIVATE" : "DEACTIVATE", "active", String(cur.active), String(active));
    return id;
  });
}

/** Changes where a role applies (its Business Unit) and until when. Unscoped roles always cover all units. */
/** Changes a role: which role it is, the Business Unit it applies in (scoped roles only) and until when. */
export async function updateRole(actor: Actor, roleId: number, buId: number | null, validTo: string | null, newRole?: Role) {
  admin(actor);
  if (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) throw new AppError("End date is not a valid date.");
  return tx(async (c) => {
    const r = await one<{ user_id: number; role: Role; bu_id: number | null; valid_to: string | null }>(
      c, "select user_id, role, bu_id, to_char(valid_to, 'YYYY-MM-DD') as valid_to from user_role where id = $1 for update", [roleId]);
    if (!r) throw new AppError("Role not found.", 404);
    const role = newRole ?? r.role;
    const def = ROLES.find((x) => x.role === role);
    if (!def) throw new AppError("Unknown role.");
    const bu = def.scoped ? buId : null;
    if (await one(c, "select 1 from user_role where user_id = $1 and role = $2 and coalesce(bu_id, 0) = coalesce($3::bigint, 0) and id <> $4",
      [r.user_id, role, bu, roleId])) {
      throw new AppError("This person already has that role there.");
    }
    const endsAdmin = r.role === "SUPER_ADMIN" && (role !== "SUPER_ADMIN" || (validTo && validTo < new Date().toISOString().slice(0, 10)));
    if (endsAdmin && (await superAdmins(c, undefined, roleId))!.n === 0) throw new AppError("Keep at least one active Super Admin.");
    await c.query("update user_role set role = $2, bu_id = $3, valid_to = $4 where id = $1", [roleId, role, bu, validTo]);
    await log(c, actor, "app_user", r.user_id, "EDIT_ROLE", "role",
      `${r.role}${r.bu_id ? ` @${r.bu_id}` : ""}${r.valid_to ? ` until ${r.valid_to}` : ""}`,
      `${role}${bu ? ` @${bu}` : ""}${validTo ? ` until ${validTo}` : ""}`);
  });
}

export async function removeRole(actor: Actor, roleId: number) {
  admin(actor);
  return tx(async (c) => {
    const r = await one<{ user_id: number; role: Role; bu_id: number | null }>(c, "select user_id, role, bu_id from user_role where id = $1", [roleId]);
    if (!r) throw new AppError("Role not found.", 404);
    if (r.role === "SUPER_ADMIN" && (await superAdmins(c, undefined, roleId))!.n === 0) throw new AppError("Keep at least one active Super Admin.");
    await c.query("delete from user_role where id = $1", [roleId]);
    await log(c, actor, "app_user", r.user_id, "REMOVE_ROLE", "role", `${r.role}${r.bu_id ? ` @${r.bu_id}` : ""}`, null);
  });
}

