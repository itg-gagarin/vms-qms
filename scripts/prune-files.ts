// Removes evidence files in STORAGE_DIR that no row in file_object points to (e.g. the demo photos left on a volume
// after the database was replaced). Dry run unless given --delete. Files are stored by content hash, so a file that a
// row points to is never touched.
//   npx tsx scripts/prune-files.ts            lists what would go
//   npx tsx scripts/prune-files.ts --delete   removes it
// In the Docker image, PRUNE_ORPHAN_FILES=delete runs it once at start-up; remove the variable afterwards.
import { readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Client } from "pg";

export async function pruneOrphanFiles(dir: string, databaseUrl: string, remove: boolean) {
  const c = new Client({ connectionString: databaseUrl });
  await c.connect();
  try {
    const keep = new Set((await c.query<{ k: string }>("select storage_key as k from file_object")).rows.map((r) => r.k.replaceAll("\\", "/")));
    const orphans: string[] = [];
    let bytes = 0;
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (!keep.has(relative(dir, p).replaceAll("\\", "/"))) { orphans.push(p); bytes += (await stat(p)).size; }
      }
    };
    await walk(dir);
    if (remove) for (const p of orphans) await rm(p);
    return { kept: keep.size, orphans: orphans.length, bytes, removed: remove };
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = resolve(process.env.STORAGE_DIR ?? "./storage");
  pruneOrphanFiles(dir, process.env.DATABASE_URL ?? "", process.argv.includes("--delete"))
    .then((r) => console.log(`prune-files: ${dir}: ${r.orphans} unreferenced file(s), ${Math.round(r.bytes / 1024)} KB${r.removed ? " removed" : " (dry run)"}; ${r.kept} referenced kept`))
    .catch((e) => { console.error("prune-files:", e.message ?? e); process.exit(1); });
}
