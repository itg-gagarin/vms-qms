import type { ReactNode } from "react";
import { STATUS_LABEL, type NcfStatus } from "@/lib/labels";

const STATUS_STYLE: Record<NcfStatus, string> = {
  DRAFT: "bg-amber-100 text-amber-900",
  WAITING_APPROVAL: "bg-sky-100 text-sky-900",
  APPROVED: "bg-indigo-100 text-indigo-900",
  SENT: "bg-orange-100 text-orange-900",
  RESPONDED: "bg-teal-100 text-teal-900",
  CLOSED: "bg-emerald-100 text-emerald-900",
  VOID: "bg-slate-200 text-slate-700",
};

export function StatusBadge({ status }: { status: NcfStatus }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[13px] font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2">{title}</h2>
        {aside && <span className="text-[13px] text-slate-600">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[200px] flex-1">
      <div className="text-[13px] font-semibold text-slate-600">{label}</div>
      <div className="mt-0.5 whitespace-pre-line text-[15px]">{children || <span className="text-slate-500">–</span>}</div>
    </div>
  );
}

export function Banner({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  const style = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    error: "border-red-200 bg-red-50 text-red-800",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[kind];
  return <div className={`rounded-md border px-4 py-3 text-sm ${style}`}>{children}</div>;
}

export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8">{children}</main>;
}
