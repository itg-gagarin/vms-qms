// NCF stages per department: which statuses each role works with, and the read check built on it.
import { hasRole, type Actor, type Role } from "@/platform/access";
import type { NcfStatus } from "./labels";

/**
 * Which NCF statuses each department works with. A user sees the union over their roles; Auditor and
 * Super Admin see every status. Lists, the detail page, prints, evidence files and the sidebar all read this.
 */
const ALL_STATUSES: NcfStatus[] = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "SENT", "RESPONDED", "CLOSED", "VOID"];
export const STATUSES_BY_ROLE: Record<Role, NcfStatus[]> = {
  QC_INSPECTOR: ["DRAFT", "WAITING_APPROVAL", "CLOSED", "VOID"],
  NCF_APPROVER: ["WAITING_APPROVAL", "APPROVED", "CLOSED", "VOID"],
  PURCHASING: ["APPROVED", "SENT", "RESPONDED", "CLOSED"],
  PCH_DIV_HEAD: ["APPROVED", "SENT", "RESPONDED", "CLOSED"],
  AUDITOR: ALL_STATUSES,
  SUPER_ADMIN: ALL_STATUSES,
};

/** NCF statuses this user may see, in workflow order. */
export function visibleStatuses(actor: Actor): NcfStatus[] {
  const mine = new Set(actor.roles.flatMap((r) => STATUSES_BY_ROLE[r.role] ?? []));
  return ALL_STATUSES.filter((s) => mine.has(s));
}

/** Internal users who may read an NCF of this BU in this status. */
export function canRead(actor: Actor, buId: number, status: NcfStatus) {
  if (!visibleStatuses(actor).includes(status)) return false;
  return hasRole(actor, ["QC_INSPECTOR", "NCF_APPROVER"], buId) ||
    hasRole(actor, ["PURCHASING", "PCH_DIV_HEAD", "AUDITOR", "SUPER_ADMIN"]);
}
