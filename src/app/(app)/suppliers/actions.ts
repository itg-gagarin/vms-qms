"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import * as sup from "@/lib/suppliers";
import { AppError } from "@/lib/util";

const s = (d: FormData, k: string) => String(d.get(k) ?? "");

async function run(fn: () => Promise<unknown>, ok: string): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok };
}

export async function createSupplierAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id: number;
  try {
    id = await sup.createSupplier(user, { code: s(d, "code"), name: s(d, "name") });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(`/suppliers/${id}`);
}

export async function renameSupplierAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  return run(() => sup.renameSupplier(user, Number(s(d, "id")), s(d, "name")), "Name saved.");
}

export async function saveContactAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  return run(() => sup.saveContact(user, {
    id: d.get("contact_id") ? Number(d.get("contact_id")) : null,
    supplierId: Number(s(d, "supplier_id")),
    name: s(d, "name"), email: s(d, "email"), phone: s(d, "phone"),
    // The edit form carries an "Active" box (absent when unticked); a new contact is always active.
    active: d.get("has_active") ? d.get("active") === "on" : true,
    ncf: d.get("ncf") === "on",
  }), "Contact saved.");
}
