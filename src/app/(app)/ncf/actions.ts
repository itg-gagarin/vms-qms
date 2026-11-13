"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import * as ncf from "@/lib/ncf";
import { AppError } from "@/lib/util";

const id = (d: FormData) => Number(d.get("id"));
const s = (d: FormData, k: string) => String(d.get(k) ?? "");

/** Runs a rule from lib/ncf; turns rule errors into a message on the form. */
async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    const out = (await fn()) ?? {};
    refresh();
    return out;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

export async function createDraftAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  let newId = 0;
  try {
    newId = await ncf.createDraft(user, Number(d.get("mrreg_id")), new Date(), d.get("po_id") ? Number(d.get("po_id")) : undefined);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(`/ncf/${newId}/edit`);
}

export async function saveHeaderAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  return run(async () => {
    await ncf.updateHeader(user, id(d), {
      inspect_date: s(d, "inspect_date"),
      inspect_time: s(d, "inspect_time"),
      goods_status: s(d, "goods_status"),
      hold_note: s(d, "hold_note"),
      problem_category_id: s(d, "problem_category_id"),
      problem_desc: s(d, "problem_desc"),
      follow_up: s(d, "follow_up"),
    });
    return { ok: "Saved." };
  });
}

export async function addItemAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  return run(async () => {
    await ncf.addItem(user, id(d), Number(d.get("line_id")), d.get("qty_sample"), d.get("qty_defect"), d.get("qty_return"));
    return { ok: "Item added." };
  });
}

export async function removeItemAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  return run(() => ncf.removeItem(user, id(d), Number(d.get("item_id"))));
}

export async function addEvidenceAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  const files = d.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const note = s(d, "note");
  if (!files.length && !note.trim()) return { error: "Choose a file or write a note." };
  return run(async () => {
    await ncf.addEvidence(user, id(d), files, note);
    return { ok: "Evidence added." };
  });
}

export async function removeEvidenceAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  return run(() => ncf.removeEvidence(user, id(d), Number(d.get("evidence_id"))));
}

export async function submitAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await ncf.submit(user, id(d), s(d, "password"));
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(`/ncf/${id(d)}`);
}

export async function decideAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  const decision = s(d, "decision") as ncf.Decision;
  if (!["APPROVED", "RETURNED", "REJECTED"].includes(decision)) return { error: "Unknown decision." };
  let st = "";
  try {
    st = await ncf.decide(user, id(d), decision, s(d, "password"), s(d, "comment"));
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  const msg = decision === "APPROVED" ? (st === "APPROVED" ? "approved-final" : "approved-step") : decision === "RETURNED" ? "returned" : "rejected";
  redirect(`/ncf/${id(d)}?msg=${msg}`);
}

export async function sendAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  const method = s(d, "method") === "LINK" ? "LINK" : "EMAIL";
  return run(async () => {
    const r = await ncf.send(user, id(d), method);
    return method === "LINK" ? { link: r.link } : { ok: "Email queued to the supplier's NCF contacts." };
  });
}

export async function reissueAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  return run(async () => ({ link: await ncf.reissueLink(user, id(d)) }));
}

export async function closeAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await ncf.close(user, id(d), s(d, "note"));
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(`/ncf/${id(d)}?msg=closed`);
}

/** Send and reissue share one form, so the generated link stays on screen after the status changes. */
export async function supplierPanelAction(prev: ActionState, d: FormData) {
  return s(d, "op") === "reissue" ? reissueAction(prev, d) : sendAction(prev, d);
}
