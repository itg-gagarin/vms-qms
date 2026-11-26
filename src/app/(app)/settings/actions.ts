"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/ui/action-form";
import * as adm from "@/modules/admin";
import * as numbering from "@/modules/ncf/numbering";
import { createApiKey, revokeApiKey } from "@/platform/api-keys";
import { requireUser } from "@/platform/auth";
import type { Role } from "@/platform/access";
import { AppError } from "@/platform/util";

const s = (d: FormData, k: string) => String(d.get(k) ?? "");
const n = (d: FormData, k: string) => (d.get(k) ? Number(d.get(k)) : null);

async function run(ok: string, fn: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<unknown>): Promise<ActionState> {
  const user = await requireUser();
  try {
    await fn(user);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok };
}

/** Creates the account and opens its page, where roles and business units are given. */
export async function createUserAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id: number;
  try {
    id = await adm.createUser(user, { name: s(d, "name"), position: s(d, "position"), email: s(d, "email"), password: s(d, "password") });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(`/settings/users/${id}?msg=created`);
}

export const addRolesAction = async (_: ActionState, d: FormData) =>
  run("Role added.", (u) => adm.addRoles(u, Number(d.get("id")), s(d, "role") as Role,
    d.getAll("bu").map((v) => (v === "all" ? null : Number(v))), s(d, "valid_to") || null));

/** The new key comes back once, in the copy box. */
export async function createApiKeyAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const key = await createApiKey(user, s(d, "name"), s(d, "scope") === "import" ? "import" : "read");
    refresh();
    return { secret: key };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

export const revokeApiKeyAction = async (_: ActionState, d: FormData) =>
  run("Key revoked. Systems using it are refused from now on.", (u) => revokeApiKey(u, Number(d.get("id"))));

export const savePositionAction = async (_: ActionState, d: FormData) =>
  run("Saved.", (u) => adm.savePosition(u, n(d, "id"), s(d, "name"), d.get("id") ? s(d, "active") === "on" : true));

export const updateUserAction = async (_: ActionState, d: FormData) =>
  run("Saved.", (u) => adm.updateUser(u, Number(d.get("id")), { name: s(d, "name"), position: s(d, "position"), email: s(d, "email") }));

export const resetPasswordAction = async (_: ActionState, d: FormData) =>
  run("Password changed.", (u) => adm.resetPassword(u, Number(d.get("id")), s(d, "password")));

export const setActiveAction = async (_: ActionState, d: FormData) =>
  run(s(d, "active") === "1" ? "Account activated." : "Account deactivated. Its records and signatures stay.", (u) =>
    adm.setActive(u, Number(d.get("id")), s(d, "active") === "1"));

export const updateRoleAction = async (_: ActionState, d: FormData) =>
  run("Role updated.", (u) => adm.updateRole(u, Number(d.get("role_id")), s(d, "bu") === "all" ? null : n(d, "bu"), s(d, "valid_to") || null,
    (s(d, "role") || undefined) as Role | undefined));

export const removeRoleAction = async (_: ActionState, d: FormData) =>
  run("Role removed.", (u) => adm.removeRole(u, Number(d.get("role_id"))));

export const saveUnitAction = async (_: ActionState, d: FormData) =>
  run("Saved.", (u) => adm.saveUnit(u, n(d, "id"), s(d, "code"), s(d, "name"), n(d, "sap_branch")));

export const saveChainAction = async (_: ActionState, d: FormData) =>
  run("Approval chain saved. It applies to NCFs submitted from now on.", (u) =>
    adm.saveChain(u, Number(d.get("bu_id")), [1, 2, 3].map((i) => ({ title: s(d, `title_${i}`), approverId: n(d, `approver_${i}`) }))));

export const saveNumberingAction = async (_: ActionState, d: FormData) =>
  run("Numbering saved.", (u) =>
    numbering.saveNumbering(u, { format: s(d, "format").trim(), reset: s(d, "reset") as numbering.Numbering["reset"] }, n(d, "next")));

export const saveWorkflowAction = async (_: ActionState, d: FormData) =>
  run("Saved. New values apply from now on.", (u) => adm.saveWorkflow(u, Object.fromEntries(adm.WORKFLOW_KEYS.map((k) => [k.key, s(d, k.key)]))));

export const saveCategoryAction = async (_: ActionState, d: FormData) =>
  run("Saved.", (u) => adm.saveCategory(u, n(d, "id"), s(d, "name"), d.get("id") ? s(d, "active") === "on" : true));

export const setHolidayAction = async (_: ActionState, d: FormData) =>
  run(s(d, "holiday") === "1" ? "Holiday added. It no longer counts as a working day." : "Back to a working day.", (u) =>
    adm.setHoliday(u, s(d, "day"), s(d, "name"), s(d, "holiday") === "1"));

export const extendCalendarAction = async (_: ActionState, d: FormData) =>
  run("Year added to the calendar.", (u) => adm.extendCalendar(u, Number(d.get("year"))));
