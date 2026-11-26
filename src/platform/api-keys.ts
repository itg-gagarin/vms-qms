// API keys for other Integra systems (e.g. the VMS) that read QMS data. Only a SHA-256 of a key is stored; the key
// itself is shown once. Callers send it as "Authorization: Bearer <key>" or "X-API-Key".
import { randomBytes } from "node:crypto";
import { requireRole, type Actor } from "./access";
import { audit } from "./audit";
import { one, pool, q, tx } from "./db";
import { AppError, sha256 } from "./util";

// ---------- Keys (Super Admin) ----------

export async function listApiKeys(actor: Actor) {
  requireRole(actor, "SUPER_ADMIN");
  return q<{ id: number; name: string; prefix: string; created_at: Date; created_by: string; last_used_at: Date | null; revoked_at: Date | null }>(
    pool,
    `select k.id, k.name, k.prefix, k.created_at, u.name as created_by, k.last_used_at, k.revoked_at
     from api_key k join app_user u on u.id = k.created_by order by k.revoked_at nulls first, k.created_at desc`,
  );
}

/** Makes a key and returns it in full, once: "vms_<prefix>_<secret>". */
export async function createApiKey(actor: Actor, name: string) {
  requireRole(actor, "SUPER_ADMIN");
  const label = name.trim();
  if (label.length < 2) throw new AppError("Name the key after the system that uses it, e.g. VMS reports.");
  const prefix = randomBytes(4).toString("hex");
  const key = `vms_${prefix}_${randomBytes(24).toString("base64url")}`;
  return tx(async (c) => {
    const r = await one<{ id: number }>(c, "insert into api_key(name, prefix, key_hash, created_by) values ($1,$2,$3,$4) returning id",
      [label, prefix, sha256(key), actor.id]);
    await audit(c, { entity: "api_key", entityId: r!.id, action: "CREATE", newValue: `${label} (${prefix})`, actorType: "USER", actorId: actor.id });
    return key;
  });
}

export async function revokeApiKey(actor: Actor, id: number) {
  requireRole(actor, "SUPER_ADMIN");
  return tx(async (c) => {
    const r = await c.query("update api_key set revoked_at = now() where id = $1 and revoked_at is null", [id]);
    if (!r.rowCount) throw new AppError("Key not found or already revoked.", 404);
    await audit(c, { entity: "api_key", entityId: id, action: "REVOKE", actorType: "USER", actorId: actor.id });
  });
}

/** The key from "Authorization: Bearer …" or "X-API-Key", checked against the stored hashes. */
export async function checkApiKey(req: Request) {
  const raw = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const m = /^vms_([0-9a-f]{8})_[A-Za-z0-9_-]{20,}$/.exec(raw.trim());
  if (!m) return null;
  const k = await one<{ id: number; key_hash: string }>(pool, "select id, key_hash from api_key where prefix = $1 and revoked_at is null", [m[1]]);
  if (!k || k.key_hash !== sha256(raw.trim())) return null;
  await pool.query("update api_key set last_used_at = now() where id = $1", [k.id]);
  return k.id;
}
