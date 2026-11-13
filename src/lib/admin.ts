// Super Admin: accounts and roles, business units, approval chains, numbering, workflow settings, problem categories,
// supplier contacts and the working-day calendar. Every change is written to audit_log.
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import type { Actor, Role } from "./core";
import { audit, requireRole } from "./core";
import { one, pool, q, tx } from "./db";
import { AppError, romanMonth, wib } from "./util";

export const ROLES: { role: Role; label: string; scoped: boolean }[] = [
  { role: "QC_INSPECTOR", label: "QC Inspector", scoped: true },
  { role: "NCF_APPROVER", label: "NCF Approver", scoped: true },
  { role: "PURCHASING", label: "Purchasing", scoped: false },
  { role: "PCH_DIV_HEAD", label: "PCH Div. Head", scoped: false },
  { role: "AUDITOR", label: "Auditor", scoped: false },
  { role: "SUPER_ADMIN", label: "Super Admin", scoped: false },
];

const admin = (actor: Actor) => requireRole(actor, "SUPER_ADMIN");
const log = (c: PoolClient, actor: Actor, entity: string, id: number, action: string, field?: string, oldValue?: string | null, newValue?: string | null) =>
  audit(c, { entity, entityId: id, action, field, oldValue: oldValue ?? null, newValue: newValue ?? null, actorType: "USER", actorId: actor.id });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

// ---------- Business units and approval chains ----------

export async function listUnits() {
  return q<{ id: number; code: string; name: string; ncfs: number }>(
    pool, "select b.id, b.code, b.name, (select count(*)::int from ncf n where n.bu_id = b.id) as ncfs from business_unit b order by b.code",
  );
}

export async function saveUnit(actor: Actor, id: number | null, code: string, name: string) {
  admin(actor);
  code = code.trim().toUpperCase();
  name = name.trim();
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw new AppError("Code: 2 to 20 letters, digits or dashes.");
  if (!name) throw new AppError("Name is required.");
  return tx(async (c) => {
    if (await one(c, "select 1 from business_unit where code = $1 and id <> coalesce($2::bigint, 0)", [code, id])) throw new AppError("That code is in use.");
    if (id) {
      const cur = await one<{ code: string; name: string }>(c, "select code, name from business_unit where id = $1", [id]);
      if (!cur) throw new AppError("Business unit not found.", 404);
      await c.query("update business_unit set code = $2, name = $3 where id = $1", [id, code, name]);
      await log(c, actor, "business_unit", id, "EDIT", "code/name", `${cur.code} ${cur.name}`, `${code} ${name}`);
      return id;
    }
    const b = await one<{ id: number }>(c, "insert into business_unit(code, name) values ($1,$2) returning id", [code, name]);
    await log(c, actor, "business_unit", b!.id, "CREATE", "code", null, code);
    return b!.id;
  });
}

export async function approvalChains() {
  return q<{ bu_id: number; step_no: number; approver_title: string; approver_id: number | null; approver: string | null }>(
    pool,
    `select s.bu_id, s.step_no, s.approver_title, s.approver_id, u.name as approver
     from approval_chain_step s left join app_user u on u.id = s.approver_id order by s.bu_id, s.step_no`,
  );
}

/** Who can be named on a chain step of this unit: active approvers of the unit or of all units. */
export async function approverOptions(buId: number) {
  return q<{ id: number; name: string; position: string | null }>(
    pool,
    `select distinct u.id, u.name, u.position from app_user u join user_role r on r.user_id = u.id
     where u.active and r.role in ('NCF_APPROVER','SUPER_ADMIN') and (r.bu_id is null or r.bu_id = $1)
       and (r.valid_to is null or r.valid_to >= current_date) order by u.name`,
    [buId],
  );
}

/** Saves steps 1 to 3 of a unit's chain. Changes apply to NCFs submitted from now on; signatures already asked for stay. */
export async function saveChain(actor: Actor, buId: number, steps: { title: string; approverId: number | null }[]) {
  admin(actor);
  const used = steps.filter((s) => s.title.trim() || s.approverId);
  if (used.length === 0) throw new AppError("The chain needs at least one step.");
  if (used.some((s) => !s.title.trim() || !s.approverId)) throw new AppError("Each step needs a title and a named approver.");
  if (new Set(used.map((s) => s.approverId)).size !== used.length) throw new AppError("The same person cannot sign two steps.");
  const allowed = new Set((await approverOptions(buId)).map((u) => u.id));
  if (used.some((s) => !allowed.has(s.approverId!))) throw new AppError("Each approver needs the NCF Approver role for this unit.");
  return tx(async (c) => {
    const before = await q<{ step_no: number; approver_title: string; approver_id: number | null }>(
      c, "select step_no, approver_title, approver_id from approval_chain_step where bu_id = $1 order by step_no", [buId],
    );
    await c.query("delete from approval_chain_step where bu_id = $1", [buId]);
    for (const [i, s] of used.entries()) {
      await c.query("insert into approval_chain_step(bu_id, step_no, approver_title, approver_id) values ($1,$2,$3,$4)",
        [buId, i + 1, s.title.trim(), s.approverId]);
    }
    await log(c, actor, "business_unit", buId, "EDIT_CHAIN", "approval_chain",
      before.map((s) => `${s.step_no}:${s.approver_title}=${s.approver_id}`).join(" "),
      used.map((s, i) => `${i + 1}:${s.title.trim()}=${s.approverId}`).join(" "));
  });
}

// ---------- Numbering ----------

export type Numbering = { format: string; reset: "yearly" | "monthly" | "never" };
export const NUMBER_TOKENS = ["{SEQ}", "{SEQ:3}", "{SEQ:4}", "{ROMAN}", "{MM}", "{YYYY}", "{YY}", "{BU}"];
export const DEFAULT_NUMBERING: Numbering = { format: "{SEQ}/{ROMAN}/{YYYY}", reset: "yearly" };

async function settingJson<T>(db: PoolClient | typeof pool, key: string, fallback: T): Promise<T> {
  const row = await one<{ value: T }>(db, "select value from setting where key = $1 and valid_from <= now() order by valid_from desc limit 1", [key]);
  return row?.value ?? fallback;
}

export async function getNumbering(db: PoolClient | typeof pool = pool): Promise<Numbering> {
  return settingJson(db, "ncf_numbering", DEFAULT_NUMBERING);
}

/** The counter key for the period a moment falls in, e.g. NCF-2026 or NCF-2026-11. */
export function counterKey(n: Numbering, now: Date) {
  const { year, month } = wib(now);
  return n.reset === "yearly" ? `NCF-${year}` : n.reset === "monthly" ? `NCF-${year}-${String(month).padStart(2, "0")}` : "NCF";
}

export function formatNumber(n: Numbering, seq: number, now: Date, bu: string) {
  const { year, month } = wib(now);
  return n.format
    .replaceAll("{SEQ:3}", String(seq).padStart(3, "0"))
    .replaceAll("{SEQ:4}", String(seq).padStart(4, "0"))
    .replaceAll("{SEQ}", String(seq))
    .replaceAll("{ROMAN}", romanMonth(month))
    .replaceAll("{MM}", String(month).padStart(2, "0"))
    .replaceAll("{YYYY}", String(year))
    .replaceAll("{YY}", String(year).slice(2))
    .replaceAll("{BU}", bu);
}

function checkNumbering(n: Numbering) {
  if (!["yearly", "monthly", "never"].includes(n.reset)) throw new AppError("Choose when the counter restarts.");
  if (!/\{SEQ(:[34])?\}/.test(n.format)) throw new AppError("The format needs the running number {SEQ}.");
  const unknown = n.format.match(/\{[^}]*\}/g)?.filter((t) => !NUMBER_TOKENS.includes(t)) ?? [];
  if (unknown.length) throw new AppError(`Unknown part: ${unknown.join(", ")}.`);
  // A counter that restarts must have the period in the number, or the same number comes back.
  if (n.reset !== "never" && !/\{YYYY\}|\{YY\}/.test(n.format)) throw new AppError("A counter that restarts needs the year ({YYYY} or {YY}) in the format.");
  if (n.reset === "monthly" && !/\{ROMAN\}|\{MM\}/.test(n.format)) throw new AppError("A counter that restarts monthly needs the month ({MM} or {ROMAN}).");
  if (n.format.length > 40) throw new AppError("The format is too long.");
}

/** Next NCF number. The counter row is locked, so numbers never repeat. */
export async function nextNumber(c: PoolClient, now: Date, buCode: string) {
  const n = await getNumbering(c);
  const row = await one<{ last: number }>(
    c,
    `insert into doc_counter(key, last) values ($1, 1) on conflict (key) do update set last = doc_counter.last + 1 returning last`,
    [counterKey(n, now)],
  );
  return formatNumber(n, row!.last, now, buCode);
}

export async function numberingState(now = new Date()) {
  const n = await getNumbering();
  const key = counterKey(n, now);
  const last = (await one<{ last: number }>(pool, "select last from doc_counter where key = $1", [key]))?.last ?? 0;
  return { ...n, key, last, preview: formatNumber(n, last + 1, now, "BU-DEMO") };
}

/** Changes the format and restart rule, and optionally where the counter continues from (never below a number already used). */
export async function saveNumbering(actor: Actor, n: Numbering, nextSeq: number | null, now = new Date()) {
  admin(actor);
  checkNumbering(n);
  return tx(async (c) => {
    const cur = await getNumbering(c);
    if (cur.format !== n.format || cur.reset !== n.reset) {
      await c.query("insert into setting(key, value, changed_by) values ('ncf_numbering', $1, $2)", [JSON.stringify(n), actor.id]);
      await log(c, actor, "setting", 0, "CHANGE", "ncf_numbering", `${cur.format} (${cur.reset})`, `${n.format} (${n.reset})`);
    }
    if (nextSeq !== null) {
      if (!Number.isInteger(nextSeq) || nextSeq < 1) throw new AppError("The next number must be a whole number from 1.");
      const key = counterKey(n, now);
      const last = (await one<{ last: number }>(c, "select last from doc_counter where key = $1 for update", [key]))?.last ?? 0;
      if (nextSeq <= last) throw new AppError(`Numbers up to ${last} are already used in this period; the next can be ${last + 1} or higher.`);
      await c.query("insert into doc_counter(key, last) values ($1,$2) on conflict (key) do update set last = $2", [key, nextSeq - 1]);
      await log(c, actor, "setting", 0, "CHANGE", `counter ${key}`, String(last), String(nextSeq - 1));
    }
  });
}

// ---------- Workflow settings ----------

export const WORKFLOW_KEYS = [
  { key: "reminder_window_wd", label: "Reminder window (working days)", help: "A reminder goes out each time this passes without a reply.", min: 1, max: 30, fallback: 2 },
  { key: "reminder_max", label: "Maximum reminders per NCF", help: "Reminders stop after this many.", min: 0, max: 10, fallback: 3 },
  { key: "token_valid_days", label: "Supplier link valid for (days)", help: "Calendar days from when the link is generated.", min: 1, max: 180, fallback: 30 },
  { key: "response_target_wd", label: "Supplier response target (working days)", help: "Replies within this count as on time in Reports.", min: 1, max: 60, fallback: 3 },
] as const;

export async function workflowSettings() {
  const out: Record<string, number> = {};
  for (const k of WORKFLOW_KEYS) out[k.key] = Number(await settingJson(pool, k.key, k.fallback));
  return out;
}

export async function saveWorkflow(actor: Actor, values: Record<string, string>) {
  admin(actor);
  const current = await workflowSettings();
  return tx(async (c) => {
    for (const k of WORKFLOW_KEYS) {
      const v = Number(values[k.key]);
      if (!Number.isInteger(v) || v < k.min || v > k.max) throw new AppError(`${k.label} must be a whole number from ${k.min} to ${k.max}.`);
      if (v === current[k.key]) continue;
      await c.query("insert into setting(key, value, changed_by) values ($1,$2,$3)", [k.key, JSON.stringify(v), actor.id]);
      await log(c, actor, "setting", 0, "CHANGE", k.key, String(current[k.key]), String(v));
    }
  });
}

// ---------- Problem categories ----------

export async function listCategories() {
  return q<{ id: number; name: string; active: boolean; used: number }>(
    pool, "select c.id, c.name, c.active, (select count(*)::int from ncf n where n.problem_category_id = c.id) as used from problem_category c order by c.active desc, c.name",
  );
}

export async function saveCategory(actor: Actor, id: number | null, name: string, active: boolean) {
  admin(actor);
  name = name.trim();
  if (!name || name.length > 60) throw new AppError("Name: 1 to 60 characters.");
  return tx(async (c) => {
    if (await one(c, "select 1 from problem_category where lower(name) = lower($1) and id <> coalesce($2::bigint, 0)", [name, id])) {
      throw new AppError("That category exists.");
    }
    if (id) {
      const cur = await one<{ name: string; active: boolean }>(c, "select name, active from problem_category where id = $1", [id]);
      if (!cur) throw new AppError("Category not found.", 404);
      await c.query("update problem_category set name = $2, active = $3 where id = $1", [id, name, active]);
      await log(c, actor, "problem_category", id, "EDIT", "name/active", `${cur.name} ${cur.active}`, `${name} ${active}`);
      return id;
    }
    const r = await one<{ id: number }>(c, "insert into problem_category(name) values ($1) returning id", [name]);
    await log(c, actor, "problem_category", r!.id, "CREATE", "name", null, name);
    return r!.id;
  });
}

// ---------- Supplier contacts (suppliers themselves come from SAP) ----------

export async function listSuppliers(term: string) {
  return q<{ id: number; code: string; name: string; contacts: { id: number; name: string; email: string | null; phone: string | null; active: boolean; ncf: boolean }[] }>(
    pool,
    `select s.id, s.sap_vendor_code as code, s.name,
            coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'active', c.active, 'ncf', c.is_ncf_recipient) order by c.id)
                      from supplier_contact c where c.supplier_id = s.id), '[]') as contacts
     from supplier s where $1 = '' or s.name ilike '%' || $1 || '%' or s.sap_vendor_code ilike '%' || $1 || '%'
     order by s.name limit 100`,
    [term.trim()],
  );
}

export async function saveContact(actor: Actor, f: { id: number | null; supplierId: number; name: string; email: string; phone: string; active: boolean; ncf: boolean }) {
  admin(actor);
  const name = f.name.trim(), email = f.email.trim().toLowerCase() || null, phone = f.phone.trim() || null;
  if (!name) throw new AppError("Contact name is required.");
  if (email && !EMAIL.test(email)) throw new AppError("Email is not valid.");
  if (!email && !phone) throw new AppError("Give an email or a phone number.");
  return tx(async (c) => {
    if (f.id) {
      const r = await c.query(
        "update supplier_contact set name=$2, email=$3, phone=$4, active=$5, is_ncf_recipient=$6 where id=$1 and supplier_id=$7",
        [f.id, name, email, phone, f.active, f.ncf, f.supplierId],
      );
      if (!r.rowCount) throw new AppError("Contact not found.", 404);
      await log(c, actor, "supplier", f.supplierId, "EDIT_CONTACT", "contact", null, `${name} ${email ?? ""} ${phone ?? ""} active=${f.active} ncf=${f.ncf}`);
      return f.id;
    }
    const r = await one<{ id: number }>(
      c, "insert into supplier_contact(supplier_id, name, email, phone, active, is_ncf_recipient) values ($1,$2,$3,$4,true,$5) returning id",
      [f.supplierId, name, email, phone, f.ncf],
    );
    await log(c, actor, "supplier", f.supplierId, "ADD_CONTACT", "contact", null, `${name} ${email ?? ""} ${phone ?? ""}`);
    return r!.id;
  });
}

// ---------- Working-day calendar ----------

export async function calendarYear(year: number) {
  return {
    days: (await one<{ n: number }>(pool, "select count(*)::int as n from calendar_day where extract(year from day) = $1", [year]))!.n,
    holidays: await q<{ day: string; name: string | null }>(
      pool,
      "select day, name from calendar_day where extract(year from day) = $1 and not is_working and extract(isodow from day) < 6 order by day",
      [year],
    ),
  };
}

/** Marks a weekday as a holiday (not a working day) or back to working. Weekends stay non-working. */
export async function setHoliday(actor: Actor, day: string, name: string, holiday: boolean) {
  admin(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError("Choose a date.");
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) throw new AppError("Weekends are never working days already.");
  if (holiday && !name.trim()) throw new AppError("Name the holiday.");
  return tx(async (c) => {
    await c.query(
      `insert into calendar_day(day, is_working, name) values ($1, $2, $3)
       on conflict (day) do update set is_working = $2, name = $3`,
      [day, !holiday, holiday ? name.trim() : null],
    );
    await log(c, actor, "calendar_day", Number(day.replaceAll("-", "")), holiday ? "ADD_HOLIDAY" : "REMOVE_HOLIDAY", "day", null, `${day} ${name.trim()}`);
  });
}

/** Adds the weekdays of a year that is not in the calendar yet, so working days can be counted. */
export async function extendCalendar(actor: Actor, year: number) {
  admin(actor);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new AppError("Choose a year.");
  return tx(async (c) => {
    const r = await c.query(
      `insert into calendar_day(day, is_working)
       select d::date, extract(isodow from d) < 6 from generate_series(make_date($1, 1, 1), make_date($1, 12, 31), interval '1 day') d
       on conflict (day) do nothing`,
      [year],
    );
    await log(c, actor, "calendar_day", year, "ADD_YEAR", "days", null, String(r.rowCount));
    return r.rowCount ?? 0;
  });
}
