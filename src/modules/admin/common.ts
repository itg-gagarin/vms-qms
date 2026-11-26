// Shared by the Master Settings rules.
import { requireRole, type Actor } from "@/platform/access";
import { auditChange } from "@/platform/audit";

/** Every Master Settings change needs Super Admin and is written to the audit log with the old and new value. */
export const admin = (actor: Actor) => requireRole(actor, "SUPER_ADMIN");
export const log = auditChange;
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
