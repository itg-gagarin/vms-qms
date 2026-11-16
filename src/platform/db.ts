import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// bigint ids stay far below 2^53, so read them as numbers. numeric as number.
// date stays a plain 'YYYY-MM-DD' string, so no timezone shift happens.
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);

declare global {
  var __vmsPool: Pool | undefined;
}

function makePool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
}

export const pool: Pool = globalThis.__vmsPool ?? makePool();
if (process.env.NODE_ENV !== "production") globalThis.__vmsPool = pool;

export type Db = Pool | PoolClient;

export async function q<T extends QueryResultRow = QueryResultRow>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await q<T>(db, text, params);
  return rows[0];
}

/** Runs fn in one transaction. Rolls back on any error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
