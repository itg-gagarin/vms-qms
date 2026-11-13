"use client";

import { BarChart3, ChevronRight, ClipboardCheck, FileWarning, Menu, Send, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/app/login/actions";

export type NavIcon = "ncf" | "receipt" | "mail" | "settings" | "chart";
/** A sub-link that is the parent's page with one query value, e.g. /ncf?status=DRAFT. */
export type NavChild = { label: string; param: string; value: string };
export type NavItem = { href: string; label: string; icon: NavIcon; children?: NavChild[] };
export type NavGroup = { label: string; items: NavItem[] };

// Lucide is the single icon source (INTEC design system).
const ICONS: Record<NavIcon, LucideIcon> = {
  ncf: FileWarning,
  receipt: ClipboardCheck,
  mail: Send,
  settings: SlidersHorizontal,
  chart: BarChart3,
};

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
    <Link href="/ncf" className="flex items-center gap-2 whitespace-nowrap font-[family-name:var(--font-display)] text-[15px] font-bold tracking-wide text-ink no-underline hover:no-underline">
      <span className="h-4 w-1.5 rounded-xs bg-advance" aria-hidden="true" />
      INTEGRA GROUP <span className="font-medium text-muted">· VMS</span>
    </Link>
  );
}

function ModuleItem({ item, active, pathname }: { item: NavItem; active: boolean; pathname: string }) {
  const search = useSearchParams();
  const kids = item.children ?? [];
  const activeKid = pathname === item.href ? kids.find((k) => search.get(k.param) === k.value) : undefined;
  // A module with sub-items opens and closes on tap, at once and without loading a page (on a phone, loading a page
  // would also close the drawer before the sub-items show). It starts open while you are inside it.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = kids.length > 0 && (manual ?? active);
  const Icon = ICONS[item.icon];
  const row = "flex w-full items-center gap-2 rounded-sm px-3 py-2.5 text-left text-[14px] no-underline hover:no-underline lg:py-2";

  if (kids.length === 0) {
    return (
      <li>
        <Link href={item.href} aria-current={active ? "page" : undefined}
          className={`${row} ${active ? "bg-tint font-semibold text-tint-ink" : "font-medium text-slate-700 hover:bg-row-hover"}`}>
          <Icon size={18} strokeWidth={2} aria-hidden="true" />
          {item.label}
        </Link>
      </li>
    );
  }

  const sub = (on: boolean) => `block rounded-sm px-2.5 py-2 text-[13px] no-underline hover:no-underline lg:py-1.5 ${
    on ? "bg-tint font-semibold text-tint-ink" : "text-muted hover:bg-row-hover hover:text-ink"
  }`;
  const worklistOn = active && pathname === item.href && !activeKid;
  return (
    <li>
      <button type="button" onClick={() => setManual(!open)} aria-expanded={open}
        className={`${row} ${active ? "font-semibold text-ink" : "font-medium text-slate-700"} hover:bg-row-hover`}>
        <Icon size={18} strokeWidth={2} aria-hidden="true" />
        <span className="flex-1">{item.label}</span>
        <ChevronRight size={16} className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mb-1 ml-[21px] mt-0.5 flex flex-col gap-0.5 border-l border-hairline pl-2">
          <li>
            <Link href={item.href} aria-current={worklistOn ? "page" : undefined} className={sub(worklistOn)}>Worklist</Link>
          </li>
          {kids.map((k) => {
            const on = k === activeKid;
            return (
              <li key={k.value}>
                <Link href={`${item.href}?${k.param}=${encodeURIComponent(k.value)}`} aria-current={on ? "page" : undefined} className={sub(on)}>
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-hairline bg-white px-4 py-3 lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpenOn(pathname)} aria-expanded={open} aria-controls="app-sidebar"
          className="rounded-sm p-2 text-slate-700 hover:bg-row-hover">
          <Menu size={20} aria-hidden="true" />
          <span className="sr-only">Open menu</span>
        </button>
      </div>

      {open && <div className="no-print fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setOpenOn(null)} aria-hidden="true" />}

      <aside id="app-sidebar"
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-hairline bg-white transition-transform lg:w-60 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}>
        <div className="flex items-center justify-between px-4 py-4">
          <Brand />
          <button type="button" onClick={() => setOpenOn(null)} className="rounded-sm p-1.5 text-muted hover:bg-row-hover lg:hidden">
            <X size={18} aria-hidden="true" />
            <span className="sr-only">Close menu</span>
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => (
            <div key={g.label} className="mb-4">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{g.label}</div>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((i) => <ModuleItem key={i.href} item={i} active={i.href === active} pathname={pathname} />)}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-hairline px-4 py-3 text-[13px]">
          <div className="font-semibold text-ink">{user.name}</div>
          {user.position && <div className="text-muted">{user.position}</div>}
          <form action={logoutAction} className="mt-1">
            <button className="-ml-2 rounded-sm px-2 py-1 text-[13px] font-medium text-tint-ink hover:bg-tint">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
