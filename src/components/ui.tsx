import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABEL, type NcfStatus } from "@/lib/labels";

// A pill means a state. Waiting is amber, done is emerald, refused is red, ready-to-advance is the green tint,
// returned-and-to-verify is indigo (info); a draft is plain slate.
const STATUS_STYLE: Record<NcfStatus, string> = {
  DRAFT: "border-slate-300 bg-slate-100 text-slate-700",
  WAITING_APPROVAL: "border-amber-300 bg-amber-50 text-amber-800",
  APPROVED: "border-[#bfe57a] bg-tint text-tint-ink",
  SENT: "border-amber-300 bg-amber-50 text-amber-800",
  RESPONDED: "border-indigo-200 bg-indigo-50 text-indigo-800",
  CLOSED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  VOID: "border-red-300 bg-red-50 text-red-800",
};

export function StatusBadge({ status }: { status: NcfStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A small rectangular tag for a code (not a state). */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-xs border border-hairline bg-white px-1.5 py-0.5 font-mono text-[12px] text-slate-700">{children}</span>;
}

/**
 * A card. `missing` marks a draft card that still blocks submitting: a quiet note while filling in, and a red outline
 * with the list once a submit has failed (`flag`).
 */
export function Section({ title, aside, children, id, missing, flag }: {
  title: string; aside?: ReactNode; children: ReactNode; id?: string; missing?: string[]; flag?: boolean;
}) {
  const todo = missing && missing.length > 0;
  const loud = todo && flag;
  return (
    <section className={`card scroll-mt-20 ${loud ? "border-red-400 ring-2 ring-red-200" : ""}`} aria-label={title} id={id}
      data-missing={loud ? "flag" : todo ? "todo" : undefined}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2">{title}</h2>
        {todo && !loud ? (
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-status-amber" />To complete
          </span>
        ) : aside ? <span className="text-[13px] text-muted">{aside}</span> : null}
      </div>
      {loud && (
        <div role="alert" className="mb-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          <b>Fill in before submitting:</b> {missing.join(" ")}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[140px] flex-1 sm:min-w-[180px]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className="mt-0.5 whitespace-pre-line text-[14px]">{children || <span className="text-muted">–</span>}</div>
    </div>
  );
}

export function Banner({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  const style = {
    info: "border-hairline bg-white text-slate-700",
    error: "border-red-200 bg-red-50 text-red-800",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-sm border px-3 py-2 text-[14px] ${style}`}>{children}</div>;
}

export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-8">{children}</main>;
}

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[30px] font-bold leading-tight">{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Underline tabs. A pill is a state, so tabs are not pills; a count is, and shows only above zero. */
export function Tabs({ items, label }: { items: { href: string; label: string; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mb-2 flex flex-wrap gap-x-5 border-b border-hairline">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
          className={`-mb-px flex items-center gap-1.5 border-b-2 py-2 text-[14px] no-underline hover:no-underline ${
            t.active ? "border-advance font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
          }`}>
          {t.label}
          {t.count ? <span className="rounded-full bg-slate-100 px-1.5 font-mono text-[11px] text-slate-700">{t.count > 99 ? "99+" : t.count}</span> : null}
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

/** A table card whose header stays put while the rows scroll. */
export function TableCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-white">
      <div className="max-h-[70vh] overflow-auto">{children}</div>
      {footer}
    </div>
  );
}
