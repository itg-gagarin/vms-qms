"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/app/login/actions";

export type NavIcon = "ncf" | "receipt" | "mail" | "settings" | "chart";
/** A sub-link that is the parent's page with one query value, e.g. /ncf?status=DRAFT. */
export type NavChild = { label: string; param: string; value: string };
export type NavItem = { href: string; label: string; icon: NavIcon; children?: NavChild[] };
export type NavGroup = { label: string; items: NavItem[] };

const ICON_PATHS: Record<NavIcon | "menu" | "close" | "chevron", string> = {
  ncf: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12 8v5M12 16v.01",
  receipt: "M9 3h6v3H9zM8 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-2M9 14l2 2 4-4",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7l8.5 6 8.5-6",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  chart: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
};

function Icon({ name, size = 20 }: { name: keyof typeof ICON_PATHS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** The item whose href is the longest prefix of the path, so /ncf/new marks its own item, not /ncf. */
function activeHref(groups: NavGroup[], pathname: string) {
  let best = "";
  for (const g of groups)
    for (const i of g.items)
      if ((pathname === i.href || pathname.startsWith(i.href + "/")) && i.href.length > best.length) best = i.href;
  return best;
}

function Brand() {
  return (
    <Link href="/ncf" className="whitespace-nowrap font-bold tracking-wide text-slate-900 no-underline">
      INTEGRA GROUP <span className="font-normal text-slate-600">· VMS</span>
    </Link>
  );
}

function ModuleItem({ item, active, pathname }: { item: NavItem; active: boolean; pathname: string }) {
  const search = useSearchParams();
  const kids = item.children ?? [];
  const activeKid = pathname === item.href ? kids.find((k) => search.get(k.param) === k.value) : undefined;
  // Open while you are inside the module; the chevron can still fold it.
  const [folded, setFolded] = useState(false);
  const open = kids.length > 0 && (active ? !folded : folded);
  const linkOn = active && !activeKid;

  return (
    <li>
      <div className={`flex items-center rounded-md ${linkOn ? "bg-brand-soft" : "hover:bg-slate-100"}`}>
        <Link href={item.href} aria-current={linkOn ? "page" : undefined}
          className={`flex flex-1 items-center gap-3 px-3 py-2 text-sm no-underline ${
            linkOn ? "font-semibold text-brand" : active ? "font-semibold text-slate-900" : "font-medium text-slate-700"
          }`}>
          <Icon name={item.icon} />
          {item.label}
        </Link>
        {kids.length > 0 && (
          <button type="button" onClick={() => setFolded((f) => !f)} aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${item.label} statuses`}
            className="mr-1 rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800">
            <span className={`block transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron" size={16} /></span>
          </button>
        )}
      </div>
      {open && (
        <ul className="mb-1 ml-[22px] mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-2.5">
          {kids.map((k) => {
            const on = k === activeKid;
            return (
              <li key={k.value}>
                <Link href={`${item.href}?${k.param}=${encodeURIComponent(k.value)}`} aria-current={on ? "page" : undefined}
                  className={`block rounded-md px-2.5 py-1.5 text-[13px] no-underline ${
                    on ? "bg-brand-soft font-semibold text-brand" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}>
                  {k.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function Sidebar({ groups, user }: { groups: NavGroup[]; user: { name: string; position: string | null } }) {
  const pathname = usePathname();
  // The phone drawer stays open only for the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const active = activeHref(groups, pathname);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Phone and tablet: top strip with a menu button */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpenOn(pathname)} aria-expanded={open} aria-controls="app-sidebar"
          className="rounded-md p-2 text-slate-700 hover:bg-slate-100">
          <Icon name="menu" />
          <span className="sr-only">Open menu</span>
        </button>
      </div>

      {open && (
        <div className="no-print fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpenOn(null)} aria-hidden="true" />
      )}

      <aside id="app-sidebar"
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform lg:w-64 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}>
        <div className="flex items-center justify-between px-5 py-5">
          <Brand />
          <button type="button" onClick={() => setOpenOn(null)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden">
            <Icon name="close" />
            <span className="sr-only">Close menu</span>
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g.label} className="mb-5">
              <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</div>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((i) => (
                  <ModuleItem key={i.href} item={i} active={i.href === active} pathname={pathname} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-5 py-4 text-sm">
          <div className="font-semibold text-slate-900">{user.name}</div>
          {user.position && <div className="text-slate-600">{user.position}</div>}
          <form action={logoutAction} className="mt-2">
            <button className="-ml-2 rounded-md px-2 py-1.5 text-sm font-semibold text-brand hover:bg-brand-soft">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
