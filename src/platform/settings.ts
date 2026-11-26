// Dated settings (setting table): the value valid at a moment, so a change never rewrites the past.
import type { Db } from "./db";
import { one } from "./db";
import { AppError } from "./util";

export async function getSetting(db: Db, key: string, at: Date = new Date()): Promise<number> {
  const row = await one<{ value: unknown }>(
    db,
    "select value from setting where key = $1 and valid_from <= $2 order by valid_from desc limit 1",
    [key, at],
  );
  if (!row) throw new AppError(`Setting ${key} is missing.`, 500);
  return Number(row.value);
}

/** The setting's stored value as it is (JSON), or the fallback when none is valid yet. */
export async function settingValue<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await one<{ value: T }>(db, "select value from setting where key = $1 and valid_from <= now() order by valid_from desc limit 1", [key]);
  return row?.value ?? fallback;
}
