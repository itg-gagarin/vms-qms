// NCF numbers (No. Komplain): the format, the period the counter restarts in, and the next number. Changed by
// Super Admin in Master Settings; used when a draft is created.
import type { PoolClient } from "pg";
import { requireRole, type Actor } from "@/platform/access";
import { auditChange } from "@/platform/audit";
import { one, pool, tx } from "@/platform/db";
import { settingValue } from "@/platform/settings";
import { AppError, romanMonth, wib } from "@/platform/util";

export type Numbering = { format: string; reset: "yearly" | "monthly" | "never" };
export const NUMBER_TOKENS = ["{SEQ}", "{SEQ:3}", "{SEQ:4}", "{ROMAN}", "{MM}", "{YYYY}", "{YY}", "{BU}"];
export const DEFAULT_NUMBERING: Numbering = { format: "{SEQ}/{ROMAN}/{YYYY}", reset: "yearly" };

export async function getNumbering(db: PoolClient | typeof pool = pool): Promise<Numbering> {
  return settingValue(db, "ncf_numbering", DEFAULT_NUMBERING);
}

/** The counter key for the period a moment falls in, e.g. NCF-2026 or NCF-2026-11. */
export function counterKey(n: Numbering, now: Date) {
  const { year, month } = wib(now);
  return n.reset === "yearly" ? `NCF-${year}` : n.reset === "monthly" ? `NCF-${year}-${String(month).padStart(2, "0")}` : "NCF";
}

export function formatNumber(n: Numbering, seq: number, now: Date, bu: string) {
  const { year, month } = wib(now);
  return n.format
    .replaceAll("{SEQ:3}", String(seq).padStart(3, "0"))
    .replaceAll("{SEQ:4}", String(seq).padStart(4, "0"))
    .replaceAll("{SEQ}", String(seq))
    .replaceAll("{ROMAN}", romanMonth(month))
    .replaceAll("{MM}", String(month).padStart(2, "0"))
    .replaceAll("{YYYY}", String(year))
    .replaceAll("{YY}", String(year).slice(2))
    .replaceAll("{BU}", bu);
}

function checkNumbering(n: Numbering) {
  if (!["yearly", "monthly", "never"].includes(n.reset)) throw new AppError("Choose when the counter restarts.");
  if (!/\{SEQ(:[34])?\}/.test(n.format)) throw new AppError("The format needs the running number {SEQ}.");
  const unknown = n.format.match(/\{[^}]*\}/g)?.filter((t) => !NUMBER_TOKENS.includes(t)) ?? [];
  if (unknown.length) throw new AppError(`Unknown part: ${unknown.join(", ")}.`);
  // A counter that restarts must have the period in the number, or the same number comes back.
  if (n.reset !== "never" && !/\{YYYY\}|\{YY\}/.test(n.format)) throw new AppError("A counter that restarts needs the year ({YYYY} or {YY}) in the format.");
  if (n.reset === "monthly" && !/\{ROMAN\}|\{MM\}/.test(n.format)) throw new AppError("A counter that restarts monthly needs the month ({MM} or {ROMAN}).");
  if (n.format.length > 40) throw new AppError("The format is too long.");
}

/** Next NCF number. The counter row is locked, so numbers never repeat. */
/** The next NCF number. Counting starts at 1 in each period; a number already on an NCF is skipped, so the counter
 * can be set back (Master Settings) without ever producing a duplicate. */
export async function nextNumber(c: PoolClient, now: Date, buCode: string) {
  const n = await getNumbering(c);
  for (let tries = 0; tries < 100_000; tries++) {
    const row = await one<{ last: number }>(
      c,
      `insert into doc_counter(key, last) values ($1, 1) on conflict (key) do update set last = doc_counter.last + 1 returning last`,
      [counterKey(n, now)],
    );
    const no = formatNumber(n, row!.last, now, buCode);
    if (!(await one(c, "select 1 from ncf where ncf_no = $1", [no]))) return no;
  }
  throw new AppError("No free NCF number in this period. Check the numbering format.", 409);
}

/** From `from` upwards, the first sequence number whose formatted NCF number is not used yet. */
async function firstFree(n: Numbering, from: number, now: Date, buCode: string) {
  let seq = from;
  while (seq < from + 100_000 && (await one(pool, "select 1 from ncf where ncf_no = $1", [formatNumber(n, seq, now, buCode)]))) seq++;
  return seq;
}

export async function numberingState(now = new Date()) {
  const n = await getNumbering();
  const key = counterKey(n, now);
  const last = (await one<{ last: number }>(pool, "select last from doc_counter where key = $1", [key]))?.last ?? 0;
  const bu = (await one<{ code: string }>(pool, "select code from business_unit order by id limit 1"))?.code ?? "BU";
  const next = await firstFree(n, last + 1, now, bu);
  return { ...n, key, last, next, preview: formatNumber(n, next, now, bu) };
}

/** Changes the format and restart rule, and optionally the next number. It may go back (e.g. to 1): numbers already
 * on an NCF are skipped when NCFs are created, so nothing is ever numbered twice. */
export async function saveNumbering(actor: Actor, n: Numbering, nextSeq: number | null, now = new Date()) {
  requireRole(actor, "SUPER_ADMIN");
  checkNumbering(n);
  return tx(async (c) => {
    const cur = await getNumbering(c);
    if (cur.format !== n.format || cur.reset !== n.reset) {
      await c.query("insert into setting(key, value, changed_by) values ('ncf_numbering', $1, $2)", [JSON.stringify(n), actor.id]);
      await auditChange(c, actor, "setting", 0, "CHANGE", "ncf_numbering", `${cur.format} (${cur.reset})`, `${n.format} (${n.reset})`);
    }
    if (nextSeq !== null) {
      if (!Number.isInteger(nextSeq) || nextSeq < 1) throw new AppError("The next number must be a whole number from 1.");
      const key = counterKey(n, now);
      const last = (await one<{ last: number }>(c, "select last from doc_counter where key = $1 for update", [key]))?.last ?? 0;
      await c.query("insert into doc_counter(key, last) values ($1,$2) on conflict (key) do update set last = $2", [key, nextSeq - 1]);
      await auditChange(c, actor, "setting", 0, "CHANGE", `counter ${key}`, String(last), String(nextSeq - 1));
    }
  });
}
