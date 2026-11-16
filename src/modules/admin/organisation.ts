// Master Settings, organisation: Business Units and each unit's approval chain (named approver per step).
import type { Actor } from "@/platform/access";
import { one, pool, q, tx } from "@/platform/db";
import { AppError } from "@/platform/util";
import { admin, log } from "./common";

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
