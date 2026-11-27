// Background jobs that run inside the app server (scheduled from src/instrumentation.ts). A lease row in job_lease
// makes sure only one server runs a job at a time, and remembers when it last ran.
import { one, pool } from "./db";

/**
 * Runs `fn` only if no other run holds the lease (or the holder's lease expired after `minutes`). Returns false when
 * the job was already running elsewhere.
 */
export async function withLease(name: string, minutes: number, fn: () => Promise<unknown>) {
  const got = await one(pool,
    `insert into job_lease(name, held_until) values ($1, now() + make_interval(mins => $2))
     on conflict (name) do update set held_until = excluded.held_until where job_lease.held_until < now()
     returning name`, [name, minutes]);
  if (!got) return false;
  try {
    await fn();
  } finally {
    await pool.query("update job_lease set held_until = now(), last_run_at = now() where name = $1", [name]);
  }
  return true;
}

/** When a job last finished (any server). */
export async function lastRun(name: string) {
  return (await one<{ last_run_at: Date | null }>(pool, "select last_run_at from job_lease where name = $1", [name]))?.last_run_at ?? null;
}
