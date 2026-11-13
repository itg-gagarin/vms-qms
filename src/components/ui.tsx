import { ChevronRight, CircleAlert, CircleCheck, Inbox, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, type NcfStatus } from "@/lib/labels";

// A pill means a state. Waiting is amber, done is emerald, refused is red, ready-to-advance is the green tint,
// returned-and-to-verify is indigo (info); a draft is plain slate. Each pill carries a dot so it reads without colour too.
const STATUS_STYLE: Record<NcfStatus, [string, string]> = {
  DRAFT: ["border-slate-200 bg-slate-50 text-slate-700", "bg-slate-400"],
  WAITING_APPROVAL: ["border-amber-200 bg-amber-50 text-amber-800", "bg-status-amber"],
  APPROVED: ["border-[#cfe9a3] bg-tint text-tint-ink", "bg-advance"],
  SENT: ["border-amber-200 bg-amber-50 text-amber-800", "bg-status-amber"],
  RESPONDED: ["border-indigo-200 bg-indigo-50 text-indigo-800", "bg-indigo-500"],
  CLOSED: ["border-emerald-200 bg-emerald-50 text-emerald-800", "bg-status-emerald"],
  VOID: ["border-red-200 bg-red-50 text-red-800", "bg-status-red"],
};

export function StatusBadge({ status }: { status: NcfStatus }) {
  const [box, dot] = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium ${box}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A state pill for anything that is not an NCF status (e.g. the SAP status of a receipt). */
export function StatePill({ tone, children }: { tone: "slate" | "amber" | "emerald" | "red" | "indigo" | "green"; children: ReactNode }) {
  const style = {
    slate: ["border-slate-200 bg-slate-50 text-slate-700", "bg-slate-400"],
    amber: ["border-amber-200 bg-amber-50 text-amber-800", "bg-status-amber"],
    emerald: ["border-emerald-200 bg-emerald-50 text-emerald-800", "bg-status-emerald"],
    red: ["border-red-200 bg-red-50 text-red-800", "bg-status-red"],
    indigo: ["border-indigo-200 bg-indigo-50 text-indigo-800", "bg-indigo-500"],
    green: ["border-[#cfe9a3] bg-tint text-tint-ink", "bg-advance"],
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium ${style[0]}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${style[1]}`} />
      {children}
    </span>
  );
}

/** A small rectangular tag for a code (not a state). */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-xs border border-hairline bg-slate-50 px-1.5 py-0.5 font-mono text-[12px] text-slate-700">{children}</span>;
}

/** Initials in a circle, for people (signers, the signed-in user). */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-tint font-semibold text-tint-ink ring-1 ring-[#cfe9a3]">
      {initials}
    </span>
  );
}

/**
 * A card with a header bar (title, optional description, optional actions) and a body.
 * `missing` marks a draft card that still blocks submitting: a quiet note while filling in, and a red outline
 * with the list once a submit has failed (`flag`). `flush` drops the body padding, for tables and lists.
 */
export function Section({ title, aside, description, actions, children, id, missing, flag, flush }: {
  title: string; aside?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string;
  missing?: string[]; flag?: boolean; flush?: boolean;
}) {
  const todo = missing && missing.length > 0;
  const loud = todo && flag;
  return (
    <section className={`card scroll-mt-20 overflow-hidden p-0 ${loud ? "border-red-400 ring-2 ring-red-200" : ""}`} aria-label={title} id={id}
      data-missing={loud ? "flag" : todo ? "todo" : undefined}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="h2">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {todo && !loud ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-800">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-status-amber" />To complete
            </span>
          ) : aside ? <span className="text-[13px] text-muted">{aside}</span> : null}
          {actions}
        </div>
      </header>
      <div className={flush ? "" : "px-4 py-4 sm:px-5"}>
        {loud && (
          <div role="alert" className={`mb-4 flex gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 ${flush ? "mx-4 mt-4 sm:mx-5" : ""}`}>
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span><b>Fill in before submitting:</b> {missing.join(" ")}</span>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[140px] flex-1 sm:min-w-[180px]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className="mt-1 whitespace-pre-line text-[14px] text-ink">{children || <span className="text-muted">–</span>}</div>
    </div>
  );
}

/** Label/value pairs in an even grid (2 columns on phones, up to 4 on wide screens). */
export function FieldGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-3 xl:grid-cols-4" }[cols];
  return <div className={`grid grid-cols-2 gap-x-6 gap-y-4 [&>div]:min-w-0 ${c}`}>{children}</div>;
}

export function Banner({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  const [style, Icon] = {
    info: ["border-hairline bg-white text-slate-700", Info],
    error: ["border-red-200 bg-red-50 text-red-800", CircleAlert],
    ok: ["border-emerald-200 bg-emerald-50 text-emerald-900", CircleCheck],
    warn: ["border-amber-200 bg-amber-50 text-amber-900", TriangleAlert],
  }[kind] as [string, typeof Info];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex gap-2.5 rounded-sm border px-3 py-2.5 text-[14px] ${style}`}>
      <Icon size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>;
}

export type Crumb = { label: string; href?: string };

/** Breadcrumbs, the page title, a line of context and the page's actions. */
export function PageHead({ title, sub, crumbs, children }: { title: ReactNode; sub?: ReactNode; crumbs?: Crumb[]; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={14} aria-hidden="true" className="text-slate-300" />}
              {c.href ? <Link href={c.href} className="text-muted no-underline hover:text-ink">{c.label}</Link> : <span className="text-ink">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-[22px] font-semibold leading-tight tracking-[-0.01em] sm:text-[24px]">{title}</h1>
          {sub && <p className="mt-1 max-w-3xl text-[14px] text-muted">{sub}</p>}
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
      <span className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Icon size={20} aria-hidden="true" /></span>
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {children && <div className="max-w-md text-[13px] text-muted">{children}</div>}
    </div>
  );
}

/** Underline tabs. A pill is a state, so tabs are not pills; a count is, and shows only above zero. */
export function Tabs({ items, label }: { items: { href: string; label: string; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-x-5 overflow-x-auto border-b border-hairline [scrollbar-width:none]">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
          className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-[14px] no-underline hover:no-underline ${
            t.active ? "border-advance font-semibold text-ink" : "border-transparent text-muted hover:border-slate-300 hover:text-ink"
          }`}>
          {t.label}
          {t.count ? (
            <span className={`rounded-full px-1.5 font-mono text-[11px] ${t.active ? "bg-tint text-tint-ink" : "bg-slate-100 text-slate-700"}`}>
              {t.count > 999 ? "999+" : t.count}
            </span>
          ) : null}
        </Link>
      ))}
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-3 py-2 text-[13px] text-muted">
      <div className="flex items-center gap-2">
        Rows per page
        {PAGE_SIZES.map((s) => (
          <Link key={s} href={href(1, s)} aria-current={s === size ? "true" : undefined}
            className={`rounded-xs border px-1.5 font-mono no-underline ${s === size ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
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
    <div className="overflow-hidden rounded-md border border-hairline bg-white">
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2.5 sm:px-4">{toolbar}</div>}
      <div className="max-h-[70vh] overflow-auto">{children}</div>
      {footer}
    </div>
  );
}
