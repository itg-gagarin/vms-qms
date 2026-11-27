import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { rebuildDb, TEST_DB } from "./helpers.mts";

const { pool } = await import("../src/platform/db.ts");
const { pruneOrphanFiles } = await import("../scripts/prune-files.ts");

before(() => rebuildDb());
after(async () => pool.end());

test("prune-files removes only files no row points to, and only with --delete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prune-"));
  await mkdir(join(dir, "ab"));
  await writeFile(join(dir, "ab", "abkept"), "evidence");
  await writeFile(join(dir, "ab", "aborphan"), "old demo photo");
  await pool.query("insert into file_object(file_name, mime, bytes, storage_key, sha256) values ('f.png','image/png',8,'ab/abkept','abkept')");
  const dry = await pruneOrphanFiles(dir, TEST_DB, false);
  assert.deepEqual([dry.orphans, dry.removed], [1, false]);
  assert.equal((await readdir(join(dir, "ab"))).length, 2, "a dry run removes nothing");
  await pruneOrphanFiles(dir, TEST_DB, true);
  assert.deepEqual(await readdir(join(dir, "ab")), ["abkept"]);
});
