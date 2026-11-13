"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { BU_COOKIE, unitsFor } from "@/lib/bu";

/** Switch the Business Unit shown in lists and reports; "all" clears it. Stays on the same page. */
export async function setBuAction(data: FormData) {
  const user = await requireUser();
  const value = String(data.get("bu") ?? "");
  const jar = await cookies();
  const units = await unitsFor(user);
  if (value !== "all" && units.some((u) => String(u.id) === value)) {
    jar.set(BU_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  } else {
    jar.delete(BU_COOKIE);
  }
  // Back to the page the switch was made on (same origin only); a detail page of another unit falls back to the list.
  const back = String(data.get("back") ?? "/ncf");
  const host = (await headers()).get("host");
  const url = new URL(back, `http://${host}`);
  redirect(url.host === host && /^\/(ncf|outbox|reports|suppliers|settings)(\/|$|\?)/.test(url.pathname + url.search) ? url.pathname + url.search : "/ncf");
}
