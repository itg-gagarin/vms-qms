// The Business Unit the user is looking at. Users who work in more than one unit (or in all of them) pick one in
// the top bar; the choice is a cookie and narrows lists, counts, receipts, the outbox and reports. It never widens
// access: a unit outside the user's scope is ignored.
import { cookies } from "next/headers";
import { buScope, type Actor } from "./core";
import { pool, q } from "./db";

export const BU_COOKIE = "vms_bu";

export type Unit = { id: number; code: string; name: string };

/** The units this user may look at, by code. */
export async function unitsFor(actor: Actor): Promise<Unit[]> {
  const scope = buScope(actor);
  return q<Unit>(pool, "select id, code, name from business_unit where $1::bigint[] is null or id = any($1) order by code", [scope]);
}

/** The chosen unit's id, or undefined for "all my units". */
export async function selectedBu(actor: Actor, units?: Unit[]): Promise<number | undefined> {
  const raw = Number((await cookies()).get(BU_COOKIE)?.value);
  if (!raw) return undefined;
  const list = units ?? (await unitsFor(actor));
  return list.length > 1 && list.some((u) => u.id === raw) ? raw : undefined;
}
