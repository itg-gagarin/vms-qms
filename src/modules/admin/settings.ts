// Master Settings, workflow: reminder window and targets, problem categories, and the working-day calendar.
import type { Actor } from "@/platform/access";
import { one, pool, q, tx } from "@/platform/db";
import { settingValue } from "@/platform/settings";
import { AppError } from "@/platform/util";
import { admin, log } from "./common";

export const WORKFLOW_KEYS = [
  { key: "reminder_window_wd", label: "Reminder window (working days)", help: "Purchasing is reminded each time this passes without a reply.", min: 1, max: 30, fallback: 2 },
  { key: "reminder_max", label: "Maximum reminders per NCF", help: "Reminders stop after this many.", min: 0, max: 10, fallback: 3 },
  { key: "response_target_wd", label: "Supplier response target (working days)", help: "Replies within this count as on time in Reports.", min: 1, max: 60, fallback: 3 },
] as const;

export async function workflowSettings() {
  const out: Record<string, number> = {};
  for (const k of WORKFLOW_KEYS) out[k.key] = Number(await settingValue(pool, k.key, k.fallback));
  return out;
}

export async function saveWorkflow(actor: Actor, values: Record<string, string>) {
  admin(actor);
  const current = await workflowSettings();
  return tx(async (c) => {
    for (const k of WORKFLOW_KEYS) {
      const v = Number(values[k.key]);
      if (!Number.isInteger(v) || v < k.min || v > k.max) throw new AppError(`${k.label} must be a whole number from ${k.min} to ${k.max}.`);
      if (v === current[k.key]) continue;
      await c.query("insert into setting(key, value, changed_by) values ($1,$2,$3)", [k.key, JSON.stringify(v), actor.id]);
      await log(c, actor, "setting", 0, "CHANGE", k.key, String(current[k.key]), String(v));
    }
  });
}

// ---------- Problem categories ----------

export async function listCategories() {
  return q<{ id: number; name: string; active: boolean; used: number }>(
    pool, "select c.id, c.name, c.active, (select count(*)::int from ncf n where n.problem_category_id = c.id) as used from problem_category c order by c.active desc, c.name",
  );
}

export async function saveCategory(actor: Actor, id: number | null, name: string, active: boolean) {
  admin(actor);
  name = name.trim();
  if (!name || name.length > 60) throw new AppError("Name: 1 to 60 characters.");
  return tx(async (c) => {
    if (await one(c, "select 1 from problem_category where lower(name) = lower($1) and id <> coalesce($2::bigint, 0)", [name, id])) {
      throw new AppError("That category exists.");
    }
    if (id) {
      const cur = await one<{ name: string; active: boolean }>(c, "select name, active from problem_category where id = $1", [id]);
      if (!cur) throw new AppError("Category not found.", 404);
      await c.query("update problem_category set name = $2, active = $3 where id = $1", [id, name, active]);
      await log(c, actor, "problem_category", id, "EDIT", "name/active", `${cur.name} ${cur.active}`, `${name} ${active}`);
      return id;
    }
    const r = await one<{ id: number }>(c, "insert into problem_category(name) values ($1) returning id", [name]);
    await log(c, actor, "problem_category", r!.id, "CREATE", "name", null, name);
    return r!.id;
  });
}

// ---------- Working-day calendar ----------

export async function calendarYear(year: number) {
  return {
    days: (await one<{ n: number }>(pool, "select count(*)::int as n from calendar_day where extract(year from day) = $1", [year]))!.n,
    // Named days off: Indonesian national holidays and cuti bersama (migration 012) and company holidays, weekends included
    // when a holiday falls on one, so the list reads like the official calendar.
    holidays: await q<{ day: string; name: string | null; kind: "NATIONAL" | "CUTI_BERSAMA" | "COMPANY" | null; weekend: boolean }>(
      pool,
      `select to_char(day, 'YYYY-MM-DD') as day, name, kind, extract(isodow from day) >= 6 as weekend from calendar_day
       where extract(year from day) = $1 and not is_working and (name is not null or extract(isodow from day) < 6) order by day`,
      [year],
    ),
  };
}

/** Marks a weekday as a holiday (not a working day) or back to working. Weekends stay non-working. */
export async function setHoliday(actor: Actor, day: string, name: string, holiday: boolean) {
  admin(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError("Choose a date.");
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) throw new AppError("Weekends are never working days already.");
  if (holiday && !name.trim()) throw new AppError("Name the holiday.");
  return tx(async (c) => {
    await c.query(
      `insert into calendar_day(day, is_working, name, kind) values ($1, $2, $3, $4)
       on conflict (day) do update set is_working = $2, name = $3, kind = $4`,
      [day, !holiday, holiday ? name.trim() : null, holiday ? "COMPANY" : null],
    );
    await log(c, actor, "calendar_day", Number(day.replaceAll("-", "")), holiday ? "ADD_HOLIDAY" : "REMOVE_HOLIDAY", "day", null, `${day} ${name.trim()}`);
  });
}

/** Adds the weekdays of a year that is not in the calendar yet, so working days can be counted. */
export async function extendCalendar(actor: Actor, year: number) {
  admin(actor);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new AppError("Choose a year.");
  return tx(async (c) => {
    const r = await c.query(
      `insert into calendar_day(day, is_working)
       select d::date, extract(isodow from d) < 6 from generate_series(make_date($1, 1, 1), make_date($1, 12, 31), interval '1 day') d
       on conflict (day) do nothing`,
      [year],
    );
    await log(c, actor, "calendar_day", year, "ADD_YEAR", "days", null, String(r.rowCount));
    return r.rowCount ?? 0;
  });
}
