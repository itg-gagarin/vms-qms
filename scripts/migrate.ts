// Applies db/migrations/*.sql in name order, once each.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set(
    (await c.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name),
  );
  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    await c.query("begin");
    try {
      await c.query(sql);
      await c.query("insert into schema_migrations(name) values ($1)", [f]);
      await c.query("commit");
      console.log("applied", f);
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  }
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
