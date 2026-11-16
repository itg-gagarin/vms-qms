"use client";

import {
  BarChart3, Bell, Building2, ChevronDown, ClipboardCheck, Factory, FileText, FileWarning, House, LogOut, Menu, PanelLeftClose, PanelLeftOpen,
  PenLine, Plus, Search, Send, SlidersHorizontal, X, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { markAllReadAction, openNoteAction, setNavAction } from "@/app/(app)/shell-actions";
import { setBuAction } from "@/app/(app)/bu-actions";
import { logoutAction } from "@/app/login/actions";

export type NavIcon = "home" | "ncf" | "receipt" | "mail" | "settings" | "chart" | "supplier";
/** A sub-link that is the parent's page with one query value, e.g. /ncf?status=DRAFT. */
export type NavChild = { label: string; param: string; value: string; count?: number };
export type NavItem = { href: string; label: string; icon: NavIcon; children?: NavChild[]; count?: number };
export type NavGroup = { label: string; items: NavItem[] };
export type NavUser = { name: string; position: string | null; roles: string[] };
export type BuOption = { id: number; code: string; name: string };
export type NoteItem = { id: number; title: string; at: string; read: boolean; todo: boolean | null };
/** The phone bar's centre button: the one thing this person does most (see platform/access primaryRole). */
export type CentreAction = { href: string; label: string; icon: "plus" | "sign" | "send" | "chart"; count?: number };

// Lucide is the single icon source (INTEC design system).
const ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  ncf: FileWarning, receipt: ClipboardCheck, mail: Send, settings: SlidersHorizontal, chart: BarChart3, supplier: Factory,
};

/** The item whose href is the longest prefix of the path, so /ncf/new marks its own item, not /ncf. */
function activeHref(groups: NavGroup[], pathname: string) {
  let best = "";
  for (const g of groups)
    for (const i of g.items)
      if ((pathname === i.href || pathname.startsWith(i.href + "/")) && i.href.length > best.length) best = i.href;
  return best;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Closes a <details> menu when the click lands outside it. */
function useOutside(ref: React.RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ref]);
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link href="/ncf" className="flex min-w-0 items-center gap-2.5 text-ink no-underline hover:no-underline" title="Integra Group · VMS">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-advance font-[family-name:var(--font-display)] text-[12px] font-bold text-advance-ink" aria-hidden="true">IG</span>
      {!compact && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="font-[family-name:var(--font-display)] text-[13px] font-bold tracking-wide">INTEGRA GROUP</span>
          <span className="text-[11px] font-medium text-muted">VMS · Quality</span>
        </span>
      )}
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

function ModuleItem({ item, active, pathname, compact }: { item: NavItem; active: boolean; pathname: string; compact: boolean }) {
  const search = useSearchParams();
  const kids = item.children ?? [];
  const activeKid = pathname === item.href ? kids.find((k) => search.get(k.param) === k.value) : undefined;
  // A module with sub-items opens and closes on tap, at once and without loading a page. It starts open inside it.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = kids.length > 0 && !compact && (manual ?? active);
  const Icon = ICONS[item.icon];
  const row = `relative flex w-full items-center gap-2.5 rounded-sm py-2 text-left text-[13px] no-underline hover:no-underline ${compact ? "justify-center px-0" : "px-2.5"}`;
  const bar = (on: boolean) => on && <span aria-hidden="true" className="absolute inset-y-1.5 -left-2 w-[3px] rounded-r-full bg-advance" />;

  // Collapsed rail, or a module without sub-items: a plain link
  if (kids.length === 0 || compact) {
    return (
      <li>
        <Link href={item.href} aria-current={active ? "page" : undefined} title={compact ? item.label : undefined}
          className={`${row} ${active ? "bg-tint font-semibold text-tint-ink" : "font-medium text-slate-700 hover:bg-row-hover hover:text-ink"}`}>
          {bar(active)}
          <Icon size={18} strokeWidth={2} aria-hidden="true" className={active ? "" : "text-slate-500"} />
          {compact ? <span className="sr-only">{item.label}</span> : <>{item.label}<Count n={item.count} on={active} /></>}
          {compact && !!item.count && <span aria-hidden="true" className="absolute right-2 top-1.5 size-2 rounded-full bg-status-amber" />}
        </Link>
      </li>
    );
  }

  const worklistOn = active && pathname === item.href && !activeKid;
  const sub = (on: boolean) => `relative flex items-center rounded-sm px-2.5 py-1.5 text-[13px] no-underline hover:no-underline ${
    on ? "bg-tint font-semibold text-tint-ink" : "text-slate-600 hover:bg-row-hover hover:text-ink"
  }`;
  return (
    <li>
      <button type="button" onClick={() => setManual(!open)} aria-expanded={open}
        className={`${row} ${active ? "font-semibold text-ink" : "font-medium text-slate-700"} hover:bg-row-hover`}>
        <Icon size={18} strokeWidth={2} aria-hidden="true" className={active ? "text-tint-ink" : "text-slate-500"} />
        <span className="flex-1">{item.label}</span>
        <ChevronDown size={15} className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mb-1 ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-hairline pl-2.5">
          <li><Link href={item.href} aria-current={worklistOn ? "page" : undefined} className={sub(worklistOn)}>Worklist <Count n={item.count} on={worklistOn} /></Link></li>
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

/**
 * The Business Unit being looked at, at the top of the sidebar. The full name wraps onto two lines; with several
 * units a native select sits over it (the phone's own picker), and choosing one reloads the same page for that unit.
 */
function UnitBlock({ units, selected, compact }: { units: BuOption[]; selected?: number; compact: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  if (units.length === 0) return null;
  const current = units.find((u) => u.id === selected);
  const label = current ? current.name : units.length === 1 ? units[0].name : "All business units";
  const code = current ? current.code : units.length === 1 ? units[0].code : `${units.length} units`;
  if (compact) {
    return (
      <div className="flex justify-center border-b border-hairline py-3" title={`Business unit: ${label}`}>
        <Building2 size={18} className="text-slate-500" aria-hidden="true" />
        <span className="sr-only">Business unit: {label}</span>
      </div>
    );
  }
  return (
    <div className="border-b border-hairline px-3 py-3">
      <form ref={ref} action={setBuAction} className="relative">
        <input type="hidden" name="back" value={`${pathname}${params.size ? `?${params}` : ""}`} />
        <div className={`flex items-center gap-2.5 rounded-sm border border-hairline bg-slate-50 px-2.5 py-2 ${units.length > 1 ? "hover:border-slate-300" : ""}`}>
          <Building2 size={17} className="shrink-0 text-slate-500" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Business unit · <span className="font-mono normal-case tracking-normal">{code}</span></span>
            <span className="line-clamp-2 block text-[13px] font-medium leading-snug text-ink">{label}</span>
          </span>
          {units.length > 1 && <ChevronDown size={15} className="shrink-0 text-muted" aria-hidden="true" />}
        </div>
        {units.length > 1 && (
          <>
            <label htmlFor="bu-switch" className="sr-only">Business unit</label>
            <select id="bu-switch" name="bu" defaultValue={selected ? String(selected) : "all"} onChange={() => ref.current?.requestSubmit()}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
              <option value="all">All business units</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
            </select>
          </>
        )}
      </form>
    </div>
  );
}

/** The signed-in person at the bottom of the sidebar, with roles and Sign out. */
function Account({ user, compact, drawer }: { user: NavUser; compact: boolean; drawer: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useOutside(ref);
  return (
    <details ref={ref} className="relative">
      <summary className={`flex cursor-pointer list-none items-center gap-2.5 rounded-sm px-2 py-2 hover:bg-row-hover [&::-webkit-details-marker]:hidden ${compact ? "justify-center" : ""}`}
        title={compact ? `${user.name} · ${user.position ?? ""}` : undefined}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tint text-[12px] font-semibold text-tint-ink ring-1 ring-[#cfe9a3]" aria-hidden="true">
          {initials(user.name)}
        </span>
        {!compact && (
          <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
            <span className="truncate text-[13px] font-semibold text-ink">{user.name}</span>
            <span className="truncate text-[11px] text-muted">{user.position}</span>
          </span>
        )}
        {!compact && <ChevronDown size={14} className={`shrink-0 text-muted ${drawer ? "rotate-180" : "-rotate-90"}`} aria-hidden="true" />}
        <span className="sr-only">Account menu</span>
      </summary>
      {/* Desktop: opens to the right of the sidebar. Phone drawer: opens above the account row. */}
      <div className={`absolute z-50 rounded-md border border-hairline bg-white p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.10)] ${
        drawer ? "bottom-full left-0 right-0 mb-1" : "bottom-0 left-full ml-3 w-64"}`}>
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

/** The bell: what needs the person's action, and what happened to their NCFs. */
function Notifications({ notes, unread }: { notes: NoteItem[]; unread: number }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useOutside(ref);
  const when = (iso: string) => {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  };
  return (
    <details ref={ref} className="relative">
      <summary className="relative flex size-9 cursor-pointer list-none items-center justify-center rounded-sm text-slate-600 hover:bg-row-hover hover:text-ink [&::-webkit-details-marker]:hidden">
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-status-red px-1 text-center font-mono text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <span className="sr-only">Notifications{unread ? `, ${unread} unread` : ""}</span>
      </summary>
      <div className="fixed inset-x-2 top-14 z-50 mt-1 max-h-[75vh] overflow-hidden rounded-md border border-hairline bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-[380px]">
        <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2.5">
          <span className="text-[13px] font-semibold text-ink">Notifications</span>
          {unread > 0 && (
            <form action={markAllReadAction}><button className="text-[12px] font-medium text-tint-ink hover:underline">Mark all as read</button></form>
          )}
        </div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {notes.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">Nothing yet. You will see here when an NCF needs you.</li>}
          {notes.map((n) => (
            <li key={n.id} className="border-b border-hairline last:border-b-0">
              <form action={openNoteAction}>
                <input type="hidden" name="id" value={n.id} />
                <button className={`flex w-full gap-2.5 px-3.5 py-2.5 text-left hover:bg-row-hover ${n.read ? "" : "bg-tint/40"}`}>
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-advance"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${n.read ? "text-slate-700" : "font-semibold text-ink"}`}>{n.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                      <span className="font-mono">{when(n.at)}</span>
                      {n.todo === true && <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 font-medium text-amber-800">To do</span>}
                      {n.todo === false && <span>Done</span>}
                    </span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * The app frame: a sidebar (Business Unit, modules, account) that collapses to an icon rail on desktop and slides
 * in on phones, and a top bar with the NCF search and notifications. The collapsed choice is kept in a cookie so the
 * server draws the right width on the first paint.
 */
export function AppShell({ groups, user, search, units, bu, notes, unread, collapsed: initial, centre, children }: {
  groups: NavGroup[]; user: NavUser; search: boolean; units: BuOption[]; bu?: number; notes: NoteItem[]; unread: number;
  collapsed: boolean; centre: CentreAction; children: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [collapsed, setCollapsed] = useState(initial);
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

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    void setNavAction(next);
  };
  // On phones the drawer is always the full sidebar.
  const rail = collapsed;
  const pad = rail ? "lg:pl-16" : "lg:pl-64";

  const side = (compact: boolean, drawer: boolean) => (
    <>
      <div className={`flex h-14 shrink-0 items-center border-b border-hairline ${compact ? "justify-center px-2" : "justify-between px-4"}`}>
        <Logo compact={compact} />
        {drawer && (
          <button type="button" onClick={() => setOpenOn(null)} className="rounded-sm p-1.5 text-muted hover:bg-row-hover">
            <X size={18} aria-hidden="true" /><span className="sr-only">Close menu</span>
          </button>
        )}
      </div>
      {!drawer && (
        <div className={`flex shrink-0 px-2 pt-2 ${compact ? "justify-center" : "justify-end"}`}>
          <button type="button" onClick={toggle} className="rounded-sm p-1.5 text-slate-500 hover:bg-row-hover hover:text-ink"
            aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} title={compact ? "Expand sidebar" : "Collapse sidebar"}>
            {compact ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
        </div>
      )}
      <UnitBlock units={units} selected={bu} compact={compact} />
      <nav aria-label="Main" className={`flex-1 overflow-y-auto py-3 ${compact ? "px-2" : "px-3"}`}>
        {groups.map((g) => (
          <div key={g.label} className="mb-4">
            {!compact && <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{g.label}</div>}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((i) => <ModuleItem key={i.href} item={i} active={i.href === active} pathname={pathname} compact={compact} />)}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-hairline p-2">
        <Account user={user} compact={compact} drawer={drawer} />
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: the sidebar, full or as an icon rail */}
      <aside className={`no-print fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-hairline bg-white transition-[width] duration-150 lg:flex ${rail ? "w-16" : "w-64"}`}>
        {side(rail, false)}
      </aside>
      {/* Phones and tablets: the same sidebar as a drawer */}
      {open && <div className="no-print fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setOpenOn(null)} aria-hidden="true" />}
      <aside id="app-sidebar" className={`no-print fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-hairline bg-white transition-transform lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}>
        {side(false, true)}
      </aside>

      <div className={`transition-[padding] duration-150 ${pad}`}>
        <header className="no-print sticky top-0 z-30 border-b border-hairline bg-white/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-3 sm:px-6">
            <button type="button" onClick={() => setOpenOn(pathname)} aria-expanded={open} aria-controls="app-sidebar"
              className="-ml-1 hidden rounded-sm p-2 text-slate-700 hover:bg-row-hover md:inline-flex lg:hidden">
              <Menu size={20} aria-hidden="true" /><span className="sr-only">Open menu</span>
            </button>
            <div className="lg:hidden"><Logo /></div>
            {search ? (
              <form action="/ncf" role="search" className="ml-auto hidden max-w-md flex-1 items-center sm:flex lg:ml-0">
                <label htmlFor="global-q" className="sr-only">Search NCFs</label>
                <div className="relative w-full">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input id="global-q" name="q" defaultValue={pathname === "/ncf" ? params.get("q") ?? "" : ""} enterKeyHint="search"
                    placeholder="Search NCF, supplier, PO or MRReg" className="input h-9 bg-slate-50 pl-9 md:h-9" />
                </div>
              </form>
            ) : <div className="flex-1" />}
            <div className="ml-auto flex items-center gap-1">
              {search && (
                <Link href="/ncf?focus=search" className="rounded-sm p-2 text-slate-600 hover:bg-row-hover sm:hidden" aria-label="Search NCFs">
                  <Search size={18} aria-hidden="true" />
                </Link>
              )}
              <div className="hidden md:block"><Notifications notes={notes} unread={unread} /></div>
            </div>
          </div>
        </header>
        {/* Phones: room under the content for the floating bar */}
        <div className="pb-28 md:pb-0">{children}</div>
      </div>
      <MobileNav centre={centre} unread={unread} onMenu={() => setOpenOn(pathname)} menuOpen={open} />
    </>
  );
}

const CENTRE_ICONS: Record<CentreAction["icon"], LucideIcon> = { plus: Plus, sign: PenLine, send: Send, chart: BarChart3 };

/**
 * Phones: a floating bar with the four places people go most and, in the middle, the one action this person does
 * most (QC: new NCF; approvers: to sign; Purchasing and PCH: the outbox; Auditor and Admin: reports).
 */
function MobileNav({ centre, unread, onMenu, menuOpen }: { centre: CentreAction; unread: number; onMenu: () => void; menuOpen: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const here = `${pathname}${params.size ? `?${params}` : ""}`;
  const Centre = CENTRE_ICONS[centre.icon];
  const item = (href: string, label: string, Icon: LucideIcon, on: boolean, badge?: number) => (
    <Link href={href} aria-current={on ? "page" : undefined}
      className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-medium no-underline hover:no-underline ${
        on ? "text-tint-ink" : "text-slate-500"}`}>
      <Icon size={20} strokeWidth={on ? 2.4 : 2} aria-hidden="true" />
      {label}
      {!!badge && (
        <span className="absolute right-[22%] top-0.5 min-w-[16px] rounded-full bg-status-red px-1 text-center font-mono text-[10px] font-semibold leading-4 text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
  return (
    <nav aria-label="Quick navigation" className="no-print fixed inset-x-3 z-30 md:hidden" style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <div className="flex h-16 items-center rounded-2xl border border-hairline bg-white/95 px-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur">
        {item("/home", "Home", House, pathname === "/home")}
        {item("/ncf", "NCFs", FileText, pathname === "/ncf" || (pathname.startsWith("/ncf/") && pathname !== "/ncf/new"))}
        <div className="flex flex-1 justify-center">
          <Link href={centre.href} aria-label={centre.label} aria-current={here === centre.href ? "page" : undefined}
            className="relative -mt-7 flex size-14 items-center justify-center rounded-full bg-advance text-advance-ink no-underline shadow-[0_8px_20px_rgba(141,198,63,0.45)] ring-4 ring-page hover:no-underline active:scale-95">
            <Centre size={24} strokeWidth={2.4} aria-hidden="true" />
            {!!centre.count && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-status-red px-1 text-center font-mono text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white">
                {centre.count > 99 ? "99+" : centre.count}
              </span>
            )}
          </Link>
        </div>
        {item("/notifications", "Alerts", Bell, pathname === "/notifications", unread)}
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-controls="app-sidebar"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-medium ${menuOpen ? "text-tint-ink" : "text-slate-500"}`}>
          <Menu size={20} aria-hidden="true" />
          Menu
        </button>
      </div>
      <span className="sr-only">{centre.label}</span>
    </nav>
  );
}
