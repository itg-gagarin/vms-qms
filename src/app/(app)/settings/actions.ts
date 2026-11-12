"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/util";
import { saveSettings, SETTING_KEYS } from "@/lib/verify";

export async function saveSettingsAction(_: ActionState, d: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await saveSettings(user, Object.fromEntries(SETTING_KEYS.map((s) => [s.key, String(d.get(s.key) ?? "")])));
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: "Saved. New values apply to NCFs sent from now on." };
}
