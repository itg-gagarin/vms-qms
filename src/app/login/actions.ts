"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/ui/action-form";
import { login, logout } from "@/platform/auth";

export async function loginAction(_: ActionState, data: FormData): Promise<ActionState> {
  const ok = await login(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
  if (!ok) return { error: "Email or password is not correct." };
  redirect("/home");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
