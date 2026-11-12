import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const nav = [
    { href: "/ncf", label: "NCF", show: true },
    { href: "/ncf/new", label: "New NCF", show: hasRole(user, "QC_INSPECTOR") },
    { href: "/outbox", label: "Email outbox", show: hasRole(user, ["SUPER_ADMIN", "PURCHASING", "PCH_DIV_HEAD"]) },
    { href: "/settings", label: "Settings", show: hasRole(user, "SUPER_ADMIN") },
  ].filter((n) => n.show);
  return (
    <>
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/ncf" className="font-bold tracking-wide text-slate-900 no-underline">
              INTEGRA GROUP <span className="font-normal text-slate-600">· VMS</span>
            </Link>
            <nav aria-label="Main" className="flex flex-wrap gap-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-100">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-700">
              <span className="font-semibold">{user.name}</span> · {user.position}
            </span>
            <form action={logoutAction}>
              <button className="rounded-md px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
