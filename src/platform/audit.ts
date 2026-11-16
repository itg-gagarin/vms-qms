// The audit trail: every state change in every module writes one row, in the same transaction as the change.
import type { Db } from "./db";

type AuditInput = {
  entity: string;
  entityId: number;
  action: string;
  field?: string;
  oldValue?: string | null;
  newValue?: string | null;
  actorType: "USER" | "SUPPLIER" | "SYSTEM";
  actorId?: number | null;
};

export async function audit(db: Db, a: AuditInput) {
  await db.query(
    `insert into audit_log(entity, entity_id, action, field, old_value, new_value, actor_type, actor_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.entity, a.entityId, a.action, a.field ?? null, a.oldValue ?? null, a.newValue ?? null, a.actorType, a.actorId ?? null],
  );
}

/** A change made by a signed-in person: one field, its old and new value. */
export const auditChange = (db: Db, actor: { id: number }, entity: string, id: number, action: string, field?: string,
  oldValue?: string | null, newValue?: string | null) =>
  audit(db, { entity, entityId: id, action, field, oldValue: oldValue ?? null, newValue: newValue ?? null, actorType: "USER", actorId: actor.id });
