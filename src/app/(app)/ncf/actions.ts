"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import * as ncf from "@/lib/ncf";
import * as pur from "@/lib/purchasing";
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
    newId = await ncf.createDraft(user, Number(d.get("mrreg_id")));
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

/** Purchasing emailed the exported form to the supplier: record when, which starts the response clock. */
export async function markSentAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await ncf.markSent(user, id(d), pur.parseWib(s(d, "sent_at")));
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(`/ncf/${id(d)}?msg=sent`);
}

/** The supplier's reply came back by email: stop the clock and keep the reply files. */
export async function markReturnedAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await pur.markReturned(user, id(d), {
      receivedAt: pur.parseWib(s(d, "received_at")),
      files: d.getAll("files").filter((f): f is File => f instanceof File),
      note: s(d, "note"),
    });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(`/ncf/${id(d)}?msg=returned-reply`);
}

/** QC picks the PO of the draft (one MRReg can hold several POs of the same supplier). */
export async function setPoAction(_: ActionState, d: FormData) {
  const user = await requireUser();
  return run(async () => {
    await ncf.setPo(user, id(d), Number(d.get("po_id")));
    return { ok: "PO set. Items now come from this PO." };
  });
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
