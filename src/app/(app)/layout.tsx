import { cookies } from "next/headers";
import { AppShell, type CentreAction, type NavGroup, type NavItem } from "@/components/shell/app-shell";
import { statusCounts } from "@/modules/ncf";
import type { NcfStatus } from "@/modules/ncf/labels";
import { REPORT_ROLES } from "@/modules/ncf/reports";
import { visibleStatuses } from "@/modules/ncf/visibility";
import { SUPPLIER_ROLES } from "@/modules/suppliers";
import { hasRole, primaryRole, ROLES } from "@/platform/access";
import { requireUser } from "@/platform/auth";
import { selectedBu, unitsFor } from "@/platform/business-units";
import { isStaging } from "@/platform/environment";
import { inbox } from "@/platform/notifications";

// Sidebar names for the NCF statuses, in workflow order. Every status is listed, so no NCF falls between links.
const NCF_STATUS_NAV: [NcfStatus, string][] = [
  ["DRAFT", "Drafts"],
  ["WAITING_APPROVAL", "Pending Approval"],
  ["APPROVED", "Approved · to send"],
  ["SENT", "Sent"],
  ["RESPONDED", "Responded"],
  ["CLOSED", "Closed"],
  ["VOID", "Void"],
];

/**
 * The frame around every internal page. The menu is grouped by area; a new QMS module adds its group or items here
 * with the roles that may open it (the same list the module's pages check). Items without a role are left out.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const seen = visibleStatuses(user);
  const units = await unitsFor(user);
  const bu = await selectedBu(user, units);
  const [counts, notes, jar] = await Promise.all([
    seen.length ? statusCounts(user, bu) : { byStatus: {} as Partial<Record<NcfStatus, number>>, toSign: 0 },
    inbox(user),
    cookies(),
  ]);

  const menu: { label: string; items: (NavItem & { show: boolean })[] }[] = [
      { label: "Workspace", items: [{ href: "/home", label: "Home", icon: "home", show: true }] },
      {
        label: "Quality · NCF",
        items: [
          {
            href: "/ncf", label: "NCF Management", icon: "ncf", show: seen.length > 0, count: counts.toSign || undefined,
            children: NCF_STATUS_NAV.filter(([value]) => seen.includes(value))
              .map(([value, label]) => ({ label, param: "status", value, count: counts.byStatus[value] })),
          },
          { href: "/ncf/new", label: "SAP Goods Receipt", icon: "receipt", show: hasRole(user, "QC_INSPECTOR") },
          { href: "/reports", label: "Reports", icon: "chart", show: hasRole(user, REPORT_ROLES) },
        ],
      },
      {
        label: "Purchasing",
        items: [
          { href: "/outbox", label: "Supplier Outbox", icon: "mail", show: hasRole(user, ["PURCHASING", "PCH_DIV_HEAD"]) },
          { href: "/suppliers", label: "Supplier Master", icon: "supplier", show: hasRole(user, SUPPLIER_ROLES) },
        ],
      },
      { label: "Administration", items: [{ href: "/settings", label: "Master Settings", icon: "settings", show: hasRole(user, "SUPER_ADMIN") }] },
  ];
  const groups: NavGroup[] = menu
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => i.show).map(({ href, label, icon, children, count }) => ({ href, label, icon, children, count })),
    }))
    .filter((g) => g.items.length > 0);

  // The phone bar's centre button follows the person's main role.
  const centre: CentreAction = {
    QC_INSPECTOR: { href: "/ncf/new", label: "New NCF", icon: "plus" },
    NCF_APPROVER: { href: "/ncf?tab=approve", label: "To sign", icon: "sign", count: counts.toSign },
    PURCHASING: { href: "/outbox", label: "Supplier Outbox", icon: "send", count: counts.byStatus.APPROVED },
    PCH_DIV_HEAD: { href: "/outbox", label: "Supplier Outbox", icon: "send", count: counts.byStatus.APPROVED },
    AUDITOR: { href: "/reports", label: "Reports", icon: "chart" },
    SUPER_ADMIN: { href: "/reports", label: "Reports", icon: "chart" },
  }[primaryRole(user)] as CentreAction;

  const roleNames = [...new Set(user.roles.map((r) => ROLES.find((x) => x.role === r.role)?.label ?? r.role))];
  return (
    <AppShell groups={groups} search={seen.length > 0} units={units} bu={bu} centre={centre} staging={isStaging()}
      collapsed={jar.get("vms_nav")?.value === "collapsed"}
      notes={notes.items.map((n) => ({ id: n.id, title: n.title, at: new Date(n.at).toISOString(), read: n.read, todo: n.todo }))} unread={notes.unread}
      user={{ name: user.name, position: user.position, roles: roleNames }}>
      {children}
    </AppShell>
  );
}
