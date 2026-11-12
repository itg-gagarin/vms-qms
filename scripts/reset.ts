// Drops and recreates the public schema. Development only.
import { Client } from "pg";
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("reset is disabled in production");
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("drop schema public cascade; create schema public;");
  await c.end();
  console.log("reset: schema dropped");
}
main().catch((e) => { console.error(e); process.exit(1); });
