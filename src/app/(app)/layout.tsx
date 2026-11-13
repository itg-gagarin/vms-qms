import { Sidebar, type NavGroup, type NavItem } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";
import { hasRole, visibleStatuses } from "@/lib/core";
import type { NcfStatus } from "@/lib/labels";

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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const seen = visibleStatuses(user);

  // One item per QMS module. A new module adds an entry here with the roles that may open it;
  // items the user has no role for are left out, and a group with nothing left is hidden.
  const groups: NavGroup[] = (
    [
      {
        label: "Active modules",
        items: [
          {
            href: "/ncf", label: "NCF Management", icon: "ncf", show: seen.length > 0,
            children: NCF_STATUS_NAV.filter(([value]) => seen.includes(value)).map(([value, label]) => ({ label, param: "status", value })),
          },
          { href: "/ncf/new", label: "SAP Goods Receipt", icon: "receipt", show: hasRole(user, "QC_INSPECTOR") },
          { href: "/outbox", label: "Email Outbox", icon: "mail", show: hasRole(user, ["SUPER_ADMIN", "PURCHASING", "PCH_DIV_HEAD"]) },
          { href: "/settings", label: "Master Settings", icon: "settings", show: hasRole(user, "SUPER_ADMIN") },
        ],
      },
    ] satisfies { label: string; items: (NavItem & { show: boolean })[] }[]
  )
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => i.show).map(({ href, label, icon, children }) => ({ href, label, icon, children })),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <Sidebar groups={groups} user={{ name: user.name, position: user.position }} />
      <div className="lg:pl-64">{children}</div>
    </>
  );
}
