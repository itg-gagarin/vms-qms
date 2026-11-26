// Working days from calendar_day (weekends, Indonesian national holidays, cuti bersama and company holidays are off).
import type { Db } from "./db";
import { one } from "./db";

/** Working days after the start date, up to and including the end date (WIB dates). */
export async function workingDaysBetween(db: Db, from: Date, to: Date): Promise<number> {
  const row = await one<{ n: number }>(
    db,
    `select count(*)::int as n from calendar_day
     where is_working
       and day > ($1::timestamptz at time zone 'Asia/Jakarta')::date
       and day <= ($2::timestamptz at time zone 'Asia/Jakarta')::date`,
    [from, to],
  );
  return row?.n ?? 0;
}
