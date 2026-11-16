// Shared by the Master Settings rules.
import type { PoolClient } from "pg";
import { requireRole, type Actor } from "@/platform/access";
import { audit } from "@/platform/audit";

/** Every Master Settings change needs Super Admin and is written to the audit log with the old and new value. */
export const admin = (actor: Actor) => requireRole(actor, "SUPER_ADMIN");
export const log = (c: PoolClient, actor: Actor, entity: string, id: number, action: string, field?: string, oldValue?: string | null, newValue?: string | null) =>
  audit(c, { entity, entityId: id, action, field, oldValue: oldValue ?? null, newValue: newValue ?? null, actorType: "USER", actorId: actor.id });
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
