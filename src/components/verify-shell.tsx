import { CircleAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The public QR pages (anyone holding the paper or PDF). One narrow card: who issued it, the verdict, then only
 * what is already printed on the form. Nothing internal (hashes, versions, workflow state, signing method).
 */
export function VerifyShell({ kind, verdict, tone, children, staffHref }: {
  kind: string; verdict: ReactNode; tone: "ok" | "bad"; children?: ReactNode; staffHref?: string;
}) {
  const Icon = tone === "ok" ? ShieldCheck : CircleAlert;
  return (
    <main className="min-h-dvh bg-page px-4 py-8 sm:py-14">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[14px] font-bold tracking-wide text-ink">
          <span className="h-4 w-1.5 rounded-xs bg-advance" aria-hidden="true" />
          INTEGRA GROUP <span className="font-medium text-muted">· {kind}</span>
        </div>
        <section className="overflow-hidden rounded-md border border-hairline bg-white">
          <div className={`flex items-start gap-3 border-b px-5 py-4 ${tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}
            role={tone === "ok" ? "status" : "alert"}>
            <Icon size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="text-[14px] leading-snug">{verdict}</div>
          </div>
          {children && <div className="flex flex-col gap-5 px-5 py-5">{children}</div>}
        </section>
        <p className="text-center text-[12px] text-muted">
          Halaman ini hanya untuk memeriksa keaslian dokumen. {staffHref && <>Staf Integra: <Link href={staffHref}>buka rekaman lengkap</Link>.</>}
        </p>
      </div>
    </main>
  );
}

/** A label/value grid, as on the paper form. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-[14px] text-ink">{v || "–"}</dd>
        </div>
      ))}
    </dl>
  );
}
