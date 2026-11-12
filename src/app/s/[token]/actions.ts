"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { respond } from "@/lib/supplier";
import { AppError } from "@/lib/util";

export async function respondAction(_: ActionState, d: FormData): Promise<ActionState> {
  const s = (k: string) => String(d.get(k) ?? "");
  const files = d.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const h = await headers();
  try {
    await respond(
      s("token"),
      {
        root_cause: s("root_cause"),
        corrective_action: s("corrective_action"),
        target_date: s("target_date"),
        preventive_action: s("preventive_action"),
        effective_from: s("effective_from"),
        responder_name: s("responder_name"),
        responder_position: s("responder_position"),
        responder_email: s("responder_email"),
        confirm: d.get("confirm") === "on",
      },
      files,
      { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined },
    );
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: "Terima kasih. Your response was submitted." };
}
