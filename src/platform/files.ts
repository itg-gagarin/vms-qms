import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Db } from "./db";
import { one } from "./db";
import { AppError, sha256 } from "./util";

export const LIMITS = {
  filesPerNcf: 10,
  filesPerCapa: 5,
  bytesPhotoOrDoc: 10 * 1024 * 1024,
  bytesVideo: 50 * 1024 * 1024,
};

const ALLOWED: Record<string, "PHOTO" | "VIDEO" | "DOC"> = {
  "image/jpeg": "PHOTO",
  "image/png": "PHOTO",
  "image/webp": "PHOTO",
  "image/heic": "PHOTO",
  "video/mp4": "VIDEO",
  "video/quicktime": "VIDEO",
  "application/pdf": "DOC",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOC",
  // Supplier replies saved from the mail client (.eml, .msg) or as plain text.
  "message/rfc822": "DOC",
  "application/vnd.ms-outlook": "DOC",
  "text/plain": "DOC",
};

export function kindOf(mime: string) {
  const k = ALLOWED[mime];
  if (!k) throw new AppError(`File type ${mime || "unknown"} is not allowed. Use photo, video, PDF, Word or Excel.`);
  return k;
}

const storageDir = () => resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");

/** Stores the bytes once per content hash and returns the file_object id. */
export async function saveFile(db: Db, file: File): Promise<{ id: number; kind: "PHOTO" | "VIDEO" | "DOC" }> {
  const kind = kindOf(file.type);
  const max = kind === "VIDEO" ? LIMITS.bytesVideo : LIMITS.bytesPhotoOrDoc;
  if (file.size === 0) throw new AppError("The file is empty.");
  if (file.size > max) throw new AppError(`${file.name} is larger than ${Math.round(max / 1024 / 1024)} MB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const hash = sha256(buf);
  const existing = await one<{ id: number }>(db, "select id::int as id from file_object where sha256 = $1", [hash]);
  if (existing) return { id: existing.id, kind };
  const key = join(hash.slice(0, 2), hash);
  await mkdir(join(/*turbopackIgnore: true*/ storageDir(), hash.slice(0, 2)), { recursive: true });
  await writeFile(join(/*turbopackIgnore: true*/ storageDir(), key), buf);
  const row = await one<{ id: number }>(
    db,
    "insert into file_object(file_name, mime, bytes, storage_key, sha256) values ($1,$2,$3,$4,$5) returning id::int as id",
    [file.name.slice(0, 200), file.type, file.size, key, hash],
  );
  return { id: row!.id, kind };
}

export async function readStoredFile(db: Db, fileId: number) {
  const f = await one<{ file_name: string; mime: string; storage_key: string }>(
    db,
    "select file_name, mime, storage_key from file_object where id = $1",
    [fileId],
  );
  if (!f) throw new AppError("File not found.", 404);
  const data = await readFile(join(/*turbopackIgnore: true*/ storageDir(), f.storage_key));
  return { ...f, data };
}
