"use client";

import {
  BarChart3, Bell, Building2, ChevronDown, ChevronsUpDown, ClipboardCheck, Factory, FileText, FileWarning, House, LogOut, Menu,
  PanelLeftClose, PanelLeftOpen, PenLine, Plus, Search, Send, SlidersHorizontal, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/components/ui/utils";
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

// Lucide is the single icon source (shadcn/ui default).
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

/** On staging the mark turns amber and says so, in the full sidebar, the icon rail and the phone header. */
function Logo({ compact, staging }: { compact?: boolean; staging?: boolean }) {
  return (
    <Link href="/home" className="flex min-w-0 items-center gap-2 text-foreground no-underline hover:no-underline" title={staging ? "Integra Group · STAGING" : "Integra Group · VMS"}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
        staging ? "bg-amber-400 text-amber-950 ring-2 ring-amber-200" : "bg-primary text-primary-foreground")} aria-hidden="true">IG</span>
      {!compact && (
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate text-sm font-semibold">Integra Group</span>
          {staging
            ? <span className="w-fit rounded-sm bg-amber-100 px-1.5 text-[11px] font-semibold tracking-wide text-amber-800">STAGING · QA</span>
            : <span className="truncate text-xs text-muted-foreground">VMS · Quality</span>}
        </span>
      )}
    </Link>
  );
}

function Count({ n, on }: { n?: number; on?: boolean }) {
  if (!n) return null;
  return (
    <span className={cn("ml-auto min-w-5 text-right font-mono text-xs font-medium tabular-nums", on ? "text-tint-foreground" : "text-muted-foreground")}>
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
  // shadcn SidebarMenuButton: 32px rows, rounded, the active one tinted INTEC green
  const row = cn("relative flex h-8 w-full items-center gap-2 rounded-md text-left text-sm no-underline outline-none transition-colors hover:no-underline focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0",
    compact ? "justify-center px-0" : "px-2");

  // Collapsed rail, or a module without sub-items: a plain link
  if (kids.length === 0 || compact) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href={item.href} aria-current={active ? "page" : undefined}
              className={cn(row, active ? "bg-tint font-medium text-tint-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
              <Icon aria-hidden="true" />
              {compact ? <span className="sr-only">{item.label}</span> : <><span className="truncate">{item.label}</span><Count n={item.count} on={active} /></>}
              {compact && !!item.count && <span aria-hidden="true" className="absolute top-1 right-2 size-1.5 rounded-full bg-status-amber" />}
            </Link>
          </TooltipTrigger>
          {compact && <TooltipContent side="right">{item.label}{item.count ? ` · ${item.count}` : ""}</TooltipContent>}
        </Tooltip>
      </li>
    );
  }

  const worklistOn = active && pathname === item.href && !activeKid;
  // shadcn SidebarMenuSubButton
  const sub = (on: boolean) => cn("relative flex h-7 items-center gap-2 rounded-md px-2 text-sm no-underline hover:no-underline",
    on ? "bg-tint font-medium text-tint-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground");
  return (
    <li>
      <button type="button" onClick={() => setManual(!open)} aria-expanded={open}
        className={cn(row, active ? "font-medium text-sidebar-foreground" : "text-sidebar-foreground/80", "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}>
        <Icon aria-hidden="true" className={active ? "text-tint-foreground" : undefined} />
        <span className="flex-1 truncate">{item.label}</span>
        <ChevronDown className={cn("text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mx-3.5 mt-0.5 mb-1 flex min-w-0 flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5">
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
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex justify-center py-2" tabIndex={0}>
            <span className="flex size-8 items-center justify-center rounded-md border bg-background"><Building2 className="size-4 text-muted-foreground" aria-hidden="true" /></span>
            <span className="sr-only">Business unit: {label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">Business unit: {label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div className="px-2 py-2">
      <form ref={ref} action={setBuAction} className="relative">
        <input type="hidden" name="back" value={`${pathname}${params.size ? `?${params}` : ""}`} />
        {/* shadcn team switcher look */}
        <div className={cn("flex items-center gap-2 rounded-lg border bg-background p-2 shadow-xs", units.length > 1 && "hover:bg-sidebar-accent")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Building2 className="size-4 text-muted-foreground" aria-hidden="true" /></span>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="line-clamp-2 text-sm font-medium">{label}</span>
            <span className="truncate text-xs text-muted-foreground">Business unit · <span className="font-mono">{code}</span></span>
          </span>
          {units.length > 1 && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
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

/** The signed-in person at the bottom of the sidebar (shadcn NavUser): roles and Sign out. Opens to the right. */
function Account({ user, compact, drawer }: { user: NavUser; compact: boolean; drawer: boolean }) {
  const out = useRef<HTMLFormElement>(null);
  const face = (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tint text-xs font-semibold text-tint-foreground" aria-hidden="true">
      {initials(user.name)}
    </span>
  );
  const who = (
    <span className="grid min-w-0 flex-1 text-left leading-tight">
      <span className="truncate text-sm font-medium">{user.name}</span>
      <span className="truncate text-xs text-muted-foreground">{user.position}</span>
    </span>
  );
  return (
    <>
      <form ref={out} action={logoutAction} hidden />
      <DropdownMenu>
        <DropdownMenuTrigger className={cn("flex w-full items-center gap-2 rounded-md p-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent",
          compact && "justify-center")}>
          {face}
          {!compact && who}
          {!compact && <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="sr-only">Account menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={drawer ? "top" : "right"} align="end" sideOffset={drawer ? 4 : 12} className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg">
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5">{face}{who}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="flex flex-wrap gap-1 px-2 py-1.5">
            {user.roles.map((r) => <Badge key={r} variant="secondary" className="rounded-md font-normal">{r}</Badge>)}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => out.current?.requestSubmit()}>
            <LogOut aria-hidden="true" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** The bell: what needs the person's action, and what happened to their NCFs. */
function Notifications({ notes, unread }: { notes: NoteItem[]; unread: number }) {
  const when = (iso: string) => {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  };
  return (
    <Popover>
      <PopoverTrigger className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent">
        <Bell className="size-[18px]" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-status-red px-1 text-center font-mono text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        <span className="sr-only">Notifications{unread ? `, ${unread} unread` : ""}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-1rem)] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <form action={markAllReadAction}><button className="text-[12px] font-medium text-tint-foreground hover:underline">Mark all as read</button></form>
          )}
        </div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {notes.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing yet. You will see here when an NCF needs you.</li>}
          {notes.map((n) => (
            <li key={n.id} className="border-b border-border last:border-b-0">
              <form action={openNoteAction}>
                <input type="hidden" name="id" value={n.id} />
                <button className={`flex w-full gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/50 ${n.read ? "" : "bg-tint/40"}`}>
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-primary"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${n.read ? "text-foreground/80" : "font-semibold text-foreground"}`}>{n.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono">{when(n.at)}</span>
                      {n.todo === true && <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 font-medium text-amber-800">To do</span>}
                      {n.todo === false && <span>Done</span>}
                    </span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <div className="border-t p-1"><Link href="/notifications" className="flex justify-center rounded-md py-1.5 text-sm font-medium no-underline hover:bg-accent hover:no-underline">See all</Link></div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The app frame: a sidebar (Business Unit, modules, account) that collapses to an icon rail on desktop and slides
 * in on phones, and a top bar with the NCF search and notifications. The collapsed choice is kept in a cookie so the
 * server draws the right width on the first paint.
 */
export function AppShell({ groups, user, search, units, bu, notes, unread, collapsed: initial, centre, staging = false, children }: {
  groups: NavGroup[]; user: NavUser; search: boolean; units: BuOption[]; bu?: number; notes: NoteItem[]; unread: number;
  collapsed: boolean; centre: CentreAction; staging?: boolean; children: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [collapsed, setCollapsed] = useState(initial);
  // The phone drawer stays open only for the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const active = activeHref(groups, pathname);

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
      <div className={cn("flex h-14 shrink-0 items-center", compact ? "justify-center px-2" : "px-4")}>
        <Logo compact={compact} staging={staging} />
      </div>
      {!drawer && (
        <div className={cn("flex shrink-0 px-2", compact ? "justify-center" : "justify-end")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={toggle} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}>
                {compact ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{compact ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent>
          </Tooltip>
        </div>
      )}
      <UnitBlock units={units} selected={bu} compact={compact} />
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-1">
        {groups.map((g) => (
          <div key={g.label} className="py-2">
            {!compact && <div className="flex h-8 items-center px-2 text-xs font-medium text-sidebar-foreground/70">{g.label}</div>}
            <ul className="flex flex-col gap-1">
              {g.items.map((i) => <ModuleItem key={i.href} item={i} active={i.href === active} pathname={pathname} compact={compact} />)}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 p-2">
        <Account user={user} compact={compact} drawer={drawer} />
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: the sidebar, full or as an icon rail */}
      <aside className={cn("no-print fixed top-[var(--stage-h,0px)] bottom-0 left-0 z-40 hidden flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear lg:flex", rail ? "w-16" : "w-64")}>
        {side(rail, false)}
      </aside>
      {/* Phones and tablets: the same sidebar in a shadcn Sheet */}
      <Sheet open={open} onOpenChange={(o) => setOpenOn(o ? pathname : null)}>
        <SheetContent id="app-sidebar" side="left" className="no-print flex w-72 flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground lg:hidden">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Modules, business unit and account</SheetDescription>
          {side(false, true)}
        </SheetContent>
      </Sheet>

      <div className={`transition-[padding] duration-150 ${pad}`}>
        <header className="no-print sticky top-[var(--stage-h,0px)] z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex h-14 items-center gap-3 px-3 sm:px-6">
            <button type="button" onClick={() => setOpenOn(pathname)} aria-expanded={open} aria-controls="app-sidebar"
              className="-ml-1 hidden size-9 items-center justify-center rounded-md text-foreground/80 hover:bg-accent md:inline-flex lg:hidden">
              <Menu className="size-5" aria-hidden="true" /><span className="sr-only">Open menu</span>
            </button>
            <div className="lg:hidden"><Logo staging={staging} /></div>
            {search ? (
              <form action="/ncf" role="search" className="ml-auto hidden max-w-md flex-1 items-center sm:flex lg:ml-0">
                <label htmlFor="global-q" className="sr-only">Search NCFs</label>
                <div className="relative w-full">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
                  <input id="global-q" name="q" defaultValue={pathname === "/ncf" ? params.get("q") ?? "" : ""} enterKeyHint="search"
                    placeholder="Search NCF, supplier, PO or MRReg" className="input h-9 bg-background pl-9 shadow-none md:h-9" />
                </div>
              </form>
            ) : <div className="flex-1" />}
            <div className="ml-auto flex items-center gap-1">
              {search && (
                <Link href="/ncf?focus=search" className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent sm:hidden" aria-label="Search NCFs">
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
        on ? "text-tint-foreground" : "text-muted-foreground"}`}>
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
      <div className="flex h-16 items-center rounded-2xl border bg-background/95 px-1.5 shadow-lg backdrop-blur">
        {item("/home", "Home", House, pathname === "/home")}
        {item("/ncf", "NCFs", FileText, pathname === "/ncf" || (pathname.startsWith("/ncf/") && pathname !== "/ncf/new"))}
        <div className="flex flex-1 justify-center">
          <Link href={centre.href} aria-label={centre.label} aria-current={here === centre.href ? "page" : undefined}
            className="relative -mt-7 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground no-underline shadow-lg shadow-primary/40 ring-4 ring-background hover:no-underline active:scale-95">
            <Centre size={24} strokeWidth={2.4} aria-hidden="true" />
            {!!centre.count && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-status-red px-1 text-center font-mono text-[10px] font-semibold leading-[18px] text-white ring-2 ring-background">
                {centre.count > 99 ? "99+" : centre.count}
              </span>
            )}
          </Link>
        </div>
        {item("/notifications", "Alerts", Bell, pathname === "/notifications", unread)}
        <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-controls="app-sidebar"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10.5px] font-medium ${menuOpen ? "text-tint-foreground" : "text-muted-foreground"}`}>
          <Menu size={20} aria-hidden="true" />
          Menu
        </button>
      </div>
      <span className="sr-only">{centre.label}</span>
    </nav>
  );
}
