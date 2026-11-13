"use client";

import { BarChart3, ChevronDown, ChevronRight, ClipboardCheck, Factory, FileWarning, LogOut, Menu, Search, Send, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/login/actions";
import { BuSwitch, type BuOption } from "./bu-switch";

export type NavIcon = "ncf" | "receipt" | "mail" | "settings" | "chart" | "supplier";
/** A sub-link that is the parent's page with one query value, e.g. /ncf?status=DRAFT. */
export type NavChild = { label: string; param: string; value: string; count?: number };
export type NavItem = { href: string; label: string; icon: NavIcon; children?: NavChild[]; count?: number };
export type NavGroup = { label: string; items: NavItem[] };
export type NavUser = { name: string; position: string | null; roles: string[] };

// Lucide is the single icon source (INTEC design system).
const ICONS: Record<NavIcon, LucideIcon> = {
  ncf: FileWarning,
  receipt: ClipboardCheck,
  mail: Send,
  settings: SlidersHorizontal,
  chart: BarChart3,
  supplier: Factory,
};

/** The item whose href is the longest prefix of the path, so /ncf/new marks its own item, not /ncf. */
function activeHref(groups: NavGroup[], pathname: string) {
  let best = "";
  for (const g of groups)
    for (const i of g.items)
      if ((pathname === i.href || pathname.startsWith(i.href + "/")) && i.href.length > best.length) best = i.href;
  return best;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

function Brand() {
  return (
    <Link href="/ncf" className="flex items-center gap-2.5 text-ink no-underline hover:no-underline">
      <span className="flex size-8 items-center justify-center rounded-sm bg-advance font-[family-name:var(--font-display)] text-[13px] font-bold text-advance-ink" aria-hidden="true">IG</span>
      <span className="flex flex-col leading-tight">
        <span className="font-[family-name:var(--font-display)] text-[14px] font-bold tracking-wide">INTEGRA GROUP</span>
        <span className="text-[11px] font-medium text-muted">VMS · Quality</span>
      </span>
    </Link>
  );
}

function Count({ n, on }: { n?: number; on?: boolean }) {
  if (!n) return null;
  return (
    <span className={`ml-auto rounded-full px-1.5 font-mono text-[11px] leading-[18px] ${on ? "bg-white/70 text-tint-ink" : "bg-slate-100 text-slate-600"}`}>
      {n > 999 ? "999+" : n}
    </span>
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
  const row = "relative flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-left text-[14px] no-underline hover:no-underline lg:py-2";
  const bar = (on: boolean) => on && <span aria-hidden="true" className="absolute inset-y-1.5 -left-2 w-[3px] rounded-r-full bg-advance" />;

  if (kids.length === 0) {
    return (
      <li>
        <Link href={item.href} aria-current={active ? "page" : undefined}
          className={`${row} ${active ? "bg-tint font-semibold text-tint-ink" : "font-medium text-slate-700 hover:bg-row-hover hover:text-ink"}`}>
          {bar(active)}
          <Icon size={18} strokeWidth={2} aria-hidden="true" className={active ? "" : "text-slate-500"} />
          {item.label}
          <Count n={item.count} on={active} />
        </Link>
      </li>
    );
  }

  const worklistOn = active && pathname === item.href && !activeKid;
  const sub = (on: boolean) => `relative flex items-center rounded-sm px-2.5 py-2 text-[13px] no-underline hover:no-underline lg:py-1.5 ${
    on ? "bg-tint font-semibold text-tint-ink" : "text-slate-600 hover:bg-row-hover hover:text-ink"
  }`;
  return (
    <li>
      <button type="button" onClick={() => setManual(!open)} aria-expanded={open}
        className={`${row} ${active ? "font-semibold text-ink" : "font-medium text-slate-700"} hover:bg-row-hover`}>
        <Icon size={18} strokeWidth={2} aria-hidden="true" className={active ? "text-tint-ink" : "text-slate-500"} />
        <span className="flex-1">{item.label}</span>
        <ChevronDown size={16} className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mb-1 ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-hairline pl-2.5">
          <li>
            <Link href={item.href} aria-current={worklistOn ? "page" : undefined} className={sub(worklistOn)}>
              Worklist <Count n={item.count} on={worklistOn} />
            </Link>
          </li>
          {kids.map((k) => {
            const on = k === activeKid;
            return (
              <li key={k.value}>
                <Link href={`${item.href}?${k.param}=${encodeURIComponent(k.value)}`} aria-current={on ? "page" : undefined} className={sub(on)}>
                  {k.label} <Count n={k.count} on={on} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** The signed-in user: name, position and roles, and signing out. */
function UserMenu({ user }: { user: NavUser }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-row-hover [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 items-center justify-center rounded-full bg-tint text-[12px] font-semibold text-tint-ink ring-1 ring-[#cfe9a3]" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="hidden min-w-0 flex-col text-left leading-tight md:flex">
          <span className="truncate text-[13px] font-semibold text-ink">{user.name}</span>
          <span className="truncate text-[11px] text-muted">{user.position}</span>
        </span>
        <ChevronDown size={14} className="hidden text-muted md:block" aria-hidden="true" />
        <span className="sr-only">Account menu</span>
      </summary>
      <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-hairline bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        <div className="px-2.5 py-2">
          <div className="text-[13px] font-semibold text-ink">{user.name}</div>
          {user.position && <div className="text-[12px] text-muted">{user.position}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            {user.roles.map((r) => <span key={r} className="rounded-xs border border-hairline bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700">{r}</span>)}
          </div>
        </div>
        <form action={logoutAction} className="border-t border-hairline pt-1">
          <button className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] font-medium text-slate-700 hover:bg-row-hover">
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

export function Sidebar({ groups, user, search, units, bu }: { groups: NavGroup[]; user: NavUser; search: boolean; units: BuOption[]; bu?: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
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
      {/* Top bar: menu (phones), search across NCFs, and the account */}
      <header className="no-print sticky top-0 z-30 border-b border-hairline bg-white/95 backdrop-blur lg:pl-64">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-6 lg:px-8">
          <button type="button" onClick={() => setOpenOn(pathname)} aria-expanded={open} aria-controls="app-sidebar"
            className="-ml-1 rounded-sm p-2 text-slate-700 hover:bg-row-hover lg:hidden">
            <Menu size={20} aria-hidden="true" />
            <span className="sr-only">Open menu</span>
          </button>
          <div className="lg:hidden"><Brand /></div>
          {search ? (
            <form action="/ncf" role="search" className="ml-auto hidden max-w-md flex-1 items-center sm:flex lg:ml-0">
              <label htmlFor="global-q" className="sr-only">Search NCFs</label>
              <div className="relative w-full">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input id="global-q" name="q" defaultValue={pathname === "/ncf" ? params.get("q") ?? "" : ""} enterKeyHint="search"
                  placeholder="Search NCF, supplier, PO or MRReg" className="input h-9 rounded-sm bg-slate-50 pl-9 text-[14px] md:h-9" />
              </div>
            </form>
          ) : <div className="flex-1" />}
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block"><BuSwitch units={units} selected={bu} /></div>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {open && <div className="no-print fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setOpenOn(null)} aria-hidden="true" />}

      <aside id="app-sidebar"
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-hairline bg-white transition-transform lg:w-64 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}>
        <div className="flex h-14 items-center justify-between border-b border-hairline px-4">
          <Brand />
          <button type="button" onClick={() => setOpenOn(null)} className="rounded-sm p-1.5 text-muted hover:bg-row-hover lg:hidden">
            <X size={18} aria-hidden="true" />
            <span className="sr-only">Close menu</span>
          </button>
        </div>

        {/* Phones: the Business Unit switch lives in the menu */}
        {units.length > 0 && <div className="border-b border-hairline px-4 py-3 sm:hidden"><BuSwitch units={units} selected={bu} id="bu-switch-menu" /></div>}
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((g) => (
            <div key={g.label} className="mb-5">
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{g.label}</div>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((i) => <ModuleItem key={i.href} item={i} active={i.href === active} pathname={pathname} />)}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2 border-t border-hairline px-4 py-3 text-[12px] text-muted">
          <ChevronRight size={14} className="text-slate-300" aria-hidden="true" />
          QMS 1 · Non Conformity Form
        </div>
      </aside>
    </>
  );
}
