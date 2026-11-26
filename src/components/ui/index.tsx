import { ChevronRight, CircleAlert, CircleCheck, Inbox, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, type NcfStatus } from "@/modules/ncf/labels";
import { Alert, AlertDescription } from "./alert";
import { Avatar as UiAvatar, AvatarFallback } from "./avatar";
import { Badge } from "./badge";
import { cn } from "./utils";

// A badge means a state (shadcn Badge, outline). Waiting is amber, done is emerald, refused is red, ready-to-advance is
// INTEC green, returned-and-to-verify is indigo; a draft is neutral. Each badge carries a dot so it reads without colour.
const TONES = {
  slate: ["border-border bg-muted/60 text-foreground/80", "bg-zinc-400"],
  amber: ["border-amber-200 bg-amber-50 text-amber-800", "bg-status-amber"],
  emerald: ["border-emerald-200 bg-emerald-50 text-emerald-800", "bg-status-emerald"],
  red: ["border-red-200 bg-red-50 text-red-800", "bg-status-red"],
  indigo: ["border-indigo-200 bg-indigo-50 text-indigo-800", "bg-indigo-500"],
  green: ["border-primary/40 bg-tint text-tint-foreground", "bg-primary"],
} as const;
type Tone = keyof typeof TONES;
const STATUS_TONE: Record<NcfStatus, Tone> = {
  DRAFT: "slate", WAITING_APPROVAL: "amber", APPROVED: "green", SENT: "amber", RESPONDED: "indigo", CLOSED: "emerald", VOID: "red",
};

export function StatusBadge({ status }: { status: NcfStatus }) {
  return <StatePill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatePill>;
}

/** A state badge for anything that is not an NCF status (e.g. the SAP status of a receipt). */
export function StatePill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const [box, dot] = TONES[tone];
  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-md px-2 font-medium", box)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} />
      {children}
    </Badge>
  );
}

/** A small tag for a code (not a state). */
export function Chip({ children }: { children: ReactNode }) {
  return <Badge variant="secondary" className="rounded-md px-1.5 font-mono font-normal">{children}</Badge>;
}

/** Initials in a circle, for people (signers, the signed-in user). */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <UiAvatar aria-hidden="true" style={{ width: size, height: size }}>
      <AvatarFallback className="bg-tint font-semibold text-tint-foreground" style={{ fontSize: Math.round(size * 0.38) }}>{initials}</AvatarFallback>
    </UiAvatar>
  );
}

/**
 * A card (shadcn Card) with a header (title, optional description, optional actions) and a body.
 * `missing` marks a draft card that still blocks submitting: a quiet badge while filling in, and a red outline
 * with the list once a submit has failed (`flag`). `flush` drops the body padding, for tables and lists.
 */
export function Section({ title, aside, description, actions, children, id, missing, flag, flush }: {
  title: string; aside?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string;
  missing?: string[]; flag?: boolean; flush?: boolean;
}) {
  const todo = missing && missing.length > 0;
  const loud = todo && flag;
  return (
    <section className={cn("scroll-mt-20 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
      loud && "border-destructive/60 ring-[3px] ring-destructive/15")} aria-label={title} id={id}
      data-missing={loud ? "flag" : todo ? "todo" : undefined}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="leading-none font-semibold">{title}</h2>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {todo && !loud ? <StatePill tone="amber">To complete</StatePill>
            : aside ? <span className="text-sm text-muted-foreground">{aside}</span> : null}
          {actions}
        </div>
      </header>
      <div className={flush ? "" : "p-4 sm:p-5"}>
        {loud && (
          <Alert variant="destructive" className={cn("mb-4 border-destructive/30 bg-destructive/5", flush && "mx-4 mt-4 w-auto")}>
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="text-destructive"><span><b>Fill in before submitting:</b> {missing.join(" ")}</span></AlertDescription>
          </Alert>
        )}
        {children}
      </div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[140px] flex-1 sm:min-w-[180px]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-line text-[13px] text-foreground">{children || <span className="text-muted-foreground">–</span>}</div>
    </div>
  );
}

/** Label/value pairs in an even grid (2 columns on phones, up to 4 on wide screens). */
export function FieldGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-3 xl:grid-cols-4" }[cols];
  return <div className={`grid grid-cols-2 gap-x-6 gap-y-4 [&>div]:min-w-0 ${c}`}>{children}</div>;
}

/** A message across the page (shadcn Alert), tinted by kind. */
export function Banner({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  const [style, Icon] = {
    info: ["", Info],
    error: ["border-red-200 bg-red-50 text-red-800 [&>svg]:text-red-600", CircleAlert],
    ok: ["border-emerald-200 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-600", CircleCheck],
    warn: ["border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600", TriangleAlert],
  }[kind] as [string, typeof Info];
  return (
    <Alert role={kind === "error" ? "alert" : "status"} className={style}>
      <Icon aria-hidden="true" />
      <AlertDescription className="text-inherit">{children}</AlertDescription>
    </Alert>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:py-6">{children}</main>;
}

export type Crumb = { label: string; href?: string };

/** Breadcrumbs, the page title, a line of context and the page's actions. */
export function PageHead({ title, sub, crumbs, children }: { title: ReactNode; sub?: ReactNode; crumbs?: Crumb[]; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={14} aria-hidden="true" className="text-zinc-300" />}
              {c.href ? <Link href={c.href} className="text-muted-foreground no-underline hover:text-foreground">{c.label}</Link> : <span className="text-foreground">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
          {sub && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{sub}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

/** Nothing to show: an icon, one line on why, and what to do. */
export function EmptyState({ icon: Icon = Inbox, title, children }: { icon?: typeof Inbox; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon size={20} aria-hidden="true" /></span>
      <div className="text-[13px] font-semibold text-foreground">{title}</div>
      {children && <div className="max-w-md text-[13px] text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Tabs as links, in the shadcn TabsList look. A count shows only above zero. */
export function Tabs({ items, label }: { items: { href: string; label: string; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={label} className="max-w-full overflow-x-auto [scrollbar-width:none]">
      <div className="inline-flex h-9 w-max items-center rounded-lg bg-muted p-[3px] text-muted-foreground">
        {items.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
            className={cn("inline-flex h-[calc(100%-1px)] items-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap no-underline transition-[color,box-shadow] hover:no-underline",
              t.active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
            {t.count ? (
              <span className={cn("rounded-md px-1.5 font-mono text-[11px] tabular-nums", t.active ? "bg-tint text-tint-foreground" : "bg-background/70 text-foreground/70")}>
                {t.count > 999 ? "999+" : t.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export const PAGE_SIZES = [10, 20, 50] as const;

/** Reads ?page= and ?size= (10, 20 or 50; default 20). */
export function paging(sp: { page?: string; size?: string }) {
  const size = PAGE_SIZES.includes(Number(sp.size) as 10) ? Number(sp.size) : 20;
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  return { page, size };
}

/** Rows-per-page (10/20/50) and previous/next, keeping the page's other filters in the link. */
export function Pager({ total, page, size, base }: { total: number; page: number; size: number; base: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const href = (p: number, s = size) => {
    const q = new URLSearchParams(Object.entries({ ...base, page: String(p), size: String(s) }).filter(([, v]) => v) as [string, string][]);
    return `?${q}`;
  };
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        Rows per page
        {PAGE_SIZES.map((s) => (
          <Link key={s} href={href(1, s)} aria-current={s === size ? "true" : undefined}
            className={cn("inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 font-mono text-[13px] no-underline hover:no-underline",
              s === size ? "border-input bg-background text-foreground shadow-xs" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground")}>
            {s}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono">{from}–{to} of {total}</span>
        {page > 1 ? <Link href={href(page - 1)} className="btn h-8 px-3">Previous</Link> : <span className="btn h-8 px-3 opacity-50">Previous</span>}
        {page < pages ? <Link href={href(page + 1)} className="btn h-8 px-3">Next</Link> : <span className="btn h-8 px-3 opacity-50">Next</span>}
      </div>
    </div>
  );
}

/** A table card: an optional toolbar (search, filters), rows under a header that stays put, and the pager. */
export function TableCard({ children, footer, toolbar }: { children: ReactNode; footer?: ReactNode; toolbar?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b px-3 py-3 sm:px-4">{toolbar}</div>}
      <div className="max-h-[70vh] overflow-auto">{children}</div>
      {footer}
    </div>
  );
}
