"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import * as adm from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import type { Role } from "@/lib/core";
import { AppError } from "@/lib/util";

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

export const createUserAction = async (_: ActionState, d: FormData) =>
  run("Account created. Give the person their password and ask them to keep it private.", (u) =>
    adm.createUser(u, { name: s(d, "name"), position: s(d, "position"), email: s(d, "email"), password: s(d, "password") }));

export const updateUserAction = async (_: ActionState, d: FormData) =>
  run("Saved.", (u) => adm.updateUser(u, Number(d.get("id")), { name: s(d, "name"), position: s(d, "position"), email: s(d, "email") }));

export const resetPasswordAction = async (_: ActionState, d: FormData) =>
  run("Password changed.", (u) => adm.resetPassword(u, Number(d.get("id")), s(d, "password")));

export const setActiveAction = async (_: ActionState, d: FormData) =>
  run(s(d, "active") === "1" ? "Account activated." : "Account deactivated. Its records and signatures stay.", (u) =>
    adm.setActive(u, Number(d.get("id")), s(d, "active") === "1"));

export const addRoleAction = async (_: ActionState, d: FormData) =>
  run("Role added.", (u) => adm.addRole(u, Number(d.get("id")), s(d, "role") as Role, n(d, "bu_id"), s(d, "valid_to") || null));

export const removeRoleAction = async (_: ActionState, d: FormData) =>
  run("Role removed.", (u) => adm.removeRole(u, Number(d.get("role_id"))));

export const saveUnitAction = async (_: ActionState, d: FormData) =>
  run("Saved.", (u) => adm.saveUnit(u, n(d, "id"), s(d, "code"), s(d, "name")));

export const saveChainAction = async (_: ActionState, d: FormData) =>
  run("Approval chain saved. It applies to NCFs submitted from now on.", (u) =>
    adm.saveChain(u, Number(d.get("bu_id")), [1, 2, 3].map((i) => ({ title: s(d, `title_${i}`), approverId: n(d, `approver_${i}`) }))));

export const saveNumberingAction = async (_: ActionState, d: FormData) =>
  run("Numbering saved.", (u) =>
    adm.saveNumbering(u, { format: s(d, "format").trim(), reset: s(d, "reset") as adm.Numbering["reset"] }, n(d, "next")));

export const saveWorkflowAction = async (_: ActionState, d: FormData) =>
  run("Saved. New values apply from now on.", (u) => adm.saveWorkflow(u, Object.fromEntries(adm.WORKFLOW_KEYS.map((k) => [k.key, s(d, k.key)]))));

export const saveCategoryAction = async (_: ActionState, d: FormData) =>
  run("Saved.", (u) => adm.saveCategory(u, n(d, "id"), s(d, "name"), d.get("id") ? s(d, "active") === "on" : true));

export const setHolidayAction = async (_: ActionState, d: FormData) =>
  run(s(d, "holiday") === "1" ? "Holiday added. It no longer counts as a working day." : "Back to a working day.", (u) =>
    adm.setHoliday(u, s(d, "day"), s(d, "name"), s(d, "holiday") === "1"));

export const extendCalendarAction = async (_: ActionState, d: FormData) =>
  run("Year added to the calendar.", (u) => adm.extendCalendar(u, Number(d.get("year"))));
