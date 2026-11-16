"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { markAllRead, openNote } from "@/lib/notifications";

/** Open a notification: mark it read and go to its NCF. */
export async function openNoteAction(data: FormData) {
  const user = await requireUser();
  redirect(await openNote(user, Number(data.get("id"))));
}

export async function markAllReadAction() {
  const user = await requireUser();
  await markAllRead(user);
  refresh();
}

/** Remember the sidebar width (expanded or collapsed) for the next page load. */
export async function setNavAction(collapsed: boolean) {
  (await cookies()).set("vms_nav", collapsed ? "collapsed" : "expanded", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}
