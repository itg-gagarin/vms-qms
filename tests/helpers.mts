import { execSync } from "node:child_process";

// Tests run against a separate database, rebuilt from the migrations and seed every run.
export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://vms:vms@localhost:55432/vms_test";
process.env.DATABASE_URL = TEST_DB;
process.env.STORAGE_DIR = "/tmp/vms-test-storage";
process.env.APP_URL = "http://test.local";

export function rebuildDb() {
  const env = { ...process.env, DATABASE_URL: TEST_DB };
  for (const s of ["scripts/reset.ts", "scripts/migrate.ts", "scripts/seed.ts"]) {
    execSync(`npx tsx ${s}`, { env, stdio: "pipe" });
  }
}

// A 1x1 PNG, enough to stand in for an inspection photo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
export const photo = (name = "cacat.png", salt = "") =>
  new File([Buffer.concat([PNG, Buffer.from(salt)])], name, { type: "image/png" });

/** A moment in WIB, e.g. at("2026-11-16 09:00"). */
export const at = (s: string) => new Date(s.replace(" ", "T") + ":00+07:00");
