import { ArrowRight, Bell, ClipboardCheck, PenLine, Plus, Send, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, Shell, StatusBadge } from "@/components/ui";
import { countNcf, listDispatch, listNcf, reminderWindow } from "@/modules/ncf";
import { dashboard, REPORT_ROLES } from "@/modules/ncf/reports";
import { hasRole, primaryRole } from "@/platform/access";
import { requireUser } from "@/platform/auth";
import { selectedBu } from "@/platform/business-units";
import { inbox } from "@/platform/notifications";
import { fmtDate, fmtDateTime, wib } from "@/platform/util";

/** One figure that needs attention, linking to the list that holds it. */
function Tile({ label, value, sub, href, tone = "default" }: { label: string; value: number | string; sub?: string; href: string; tone?: "default" | "warn" }) {
  return (
    <Link href={href} className="group flex flex-col gap-1.5 rounded-xl border bg-card shadow-sm p-4 text-foreground no-underline transition-colors hover:bg-muted/30 hover:no-underline">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {tone === "warn" && <span aria-hidden="true" className="size-1.5 rounded-full bg-status-amber" />}{label}
      </span>
      <span className="text-3xl leading-none font-semibold tabular-nums">{value}</span>
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {sub ?? ""}<ArrowRight size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </span>
    </Link>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden p-0">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="h2">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * The landing page after sign-in: what needs this person now, by role. QC sees drafts and the way to a new NCF,
 * approvers what waits for their signature, Purchasing what to send, chase and close, Auditor and Admin the figures.
 */
export default async function HomePage() {
  const user = await requireUser();
  const role = primaryRole(user);
  const bu = await selectedBu(user);
  // Approvers and Auditors may see later stages, but only Purchasing and PCH Div. Head send and close: their work only.
  const sends = hasRole(user, ["PURCHASING", "PCH_DIV_HEAD"]);

  const [mine, toSign, toSend, waiting, toVerify, signQueue, myQueue, sendQueue, chase, window, notes] = await Promise.all([
    hasRole(user, "QC_INSPECTOR") ? countNcf(user, "mine", undefined, "", bu) : 0,
    hasRole(user, "NCF_APPROVER") ? countNcf(user, "approve", undefined, "", bu) : 0,
    sends ? countNcf(user, "send", undefined, "", bu) : 0,
    sends ? countNcf(user, "waiting", undefined, "", bu) : 0,
    sends ? countNcf(user, "verify", undefined, "", bu) : 0,
    hasRole(user, "NCF_APPROVER") ? listNcf(user, "approve", undefined, 1, 6, "", bu) : [],
    hasRole(user, "QC_INSPECTOR") ? listNcf(user, "mine", undefined, 1, 6, "", bu) : [],
    sends ? listDispatch(user, "send", 1, 6, bu) : { rows: [], total: 0 },
    sends ? listDispatch(user, "waiting", 1, 50, bu) : { rows: [], total: 0 },
    reminderWindow(),
    inbox(user, 6),
  ]);
  const overdue = chase.rows.filter((r) => r.running && (r.working_days ?? 0) > window);
  const year = wib(new Date()).date.slice(0, 4);
  const figures = hasRole(user, REPORT_ROLES) && ["AUDITOR", "SUPER_ADMIN"].includes(role)
    ? await dashboard(user, { from: `${year}-01-01`, to: wib(new Date()).date, buId: bu }) : null;

  const hour = Number(wib(new Date()).time.slice(0, 2));
  const greeting = hour < 11 ? "Good morning" : hour < 15 ? "Good afternoon" : "Good evening";
  const first = user.name.split(" ")[0];

  // The one main action for this person, as on the phone bar.
  const main: { href: string; label: string; icon: LucideIcon } | null =
    role === "QC_INSPECTOR" ? { href: "/ncf/new", label: "New NCF", icon: Plus }
      : role === "NCF_APPROVER" && signQueue[0] ? { href: `/ncf/${signQueue[0].id}`, label: `Start signing (${toSign})`, icon: PenLine }
      : (role === "PURCHASING" || role === "PCH_DIV_HEAD") ? { href: "/outbox", label: "Open Supplier Outbox", icon: Send }
      : null;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="num text-[12px] text-muted-foreground">{fmtDate(new Date())} · WIB</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{greeting}, {first}</h1>
          <p className="text-[13px] text-muted-foreground">{user.position ?? ""}{user.position ? " · " : ""}here is what needs you today.</p>
        </div>
        {/* On phones the bottom bar's centre button is this action. */}
        {main && <Link href={main.href} className="btn btn-advance hidden md:inline-flex"><main.icon size={16} aria-hidden="true" /> {main.label}</Link>}
      </div>

      <section aria-label="Needs your attention" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {hasRole(user, "QC_INSPECTOR") && <Tile label="My drafts and pending" value={mine} sub="drafts and waiting approval" href="/ncf?tab=mine" />}
        {hasRole(user, "NCF_APPROVER") && <Tile label="Waiting for my signature" value={toSign} sub={toSign ? "oldest first" : "nothing to sign"} href="/ncf?tab=approve" tone={toSign ? "warn" : "default"} />}
        {sends && <Tile label="Approved, to send" value={toSend} sub="export and email the form" href="/ncf?tab=send" />}
        {sends && <Tile label="Waiting for supplier" value={waiting} sub={overdue.length ? `${overdue.length} over ${window} working days` : "within the window"} href="/outbox?tab=waiting" tone={overdue.length ? "warn" : "default"} />}
        {sends && <Tile label="Replied, to verify" value={toVerify} sub="check the reply and close" href="/ncf?tab=verify" />}
        {figures && <Tile label="Median supplier reply" value={figures.kpi.median_wd === null ? "–" : `${figures.kpi.median_wd} wd`} sub={`${figures.kpi.responded} replies in ${year}`} href="/reports" />}
        {figures && <Tile label="Open NCFs" value={figures.kpi.open} sub={`${figures.kpi.raised} raised in ${year}`} href="/ncf?tab=all" />}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {hasRole(user, "NCF_APPROVER") && (
            <Card title="Waiting for your signature" action={toSign > 6 ? <Link href="/ncf?tab=approve" className="text-[12px]">All {toSign}</Link> : undefined}>
              {signQueue.length === 0 ? <EmptyState icon={PenLine} title="Nothing to sign">NCFs appear here when it is your turn in the approval chain.</EmptyState> : (
                <ul className="divide-y divide-border">
                  {signQueue.map((n) => (
                    <li key={n.id}>
                      <Link href={`/ncf/${n.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-muted/50 hover:no-underline">
                        <span className="min-w-0">
                          <span className="num block font-semibold text-tint-foreground">{n.ncf_no}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{n.supplier_name} · {n.items} item{n.items === 1 ? "" : "s"} · {n.defects} cacat</span>
                        </span>
                        <span className="btn h-8 shrink-0 px-3 md:h-8">Review</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {hasRole(user, ["PURCHASING", "PCH_DIV_HEAD"]) && (
            <Card title="To send to suppliers" action={<Link href="/outbox" className="text-[12px]">Supplier Outbox</Link>}>
              {sendQueue.rows.length === 0 ? <EmptyState icon={Send} title="Nothing to send">Approved NCFs appear here.</EmptyState> : (
                <ul className="divide-y divide-border">
                  {sendQueue.rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/ncf/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-muted/50 hover:no-underline">
                        <span className="min-w-0">
                          <span className="num block font-semibold text-tint-foreground">{r.ncf_no}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{r.supplier} · {r.contacts[0]?.email ?? r.contacts[0]?.phone ?? "no contact on file"}</span>
                        </span>
                        <span className="num shrink-0 text-[12px] text-muted-foreground">approved {fmtDate(r.approved_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {overdue.length > 0 && (
                <div className="border-t border-border bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
                  <b>{overdue.length} supplier{overdue.length === 1 ? " has" : "s have"} not replied</b> within {window} working days.{" "}
                  <Link href="/outbox?tab=waiting">See who to chase</Link>
                </div>
              )}
            </Card>
          )}
          {hasRole(user, "QC_INSPECTOR") && (
            <Card title="My NCFs in progress" action={<Link href="/ncf/new" className="text-[12px]">Open goods receipts</Link>}>
              {myQueue.length === 0 ? <EmptyState icon={ClipboardCheck} title="No draft in progress">Start from an open goods receipt.</EmptyState> : (
                <ul className="divide-y divide-border">
                  {myQueue.map((n) => (
                    <li key={n.id}>
                      <Link href={n.status === "DRAFT" ? `/ncf/${n.id}/edit` : `/ncf/${n.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-muted/50 hover:no-underline">
                        <span className="min-w-0">
                          <span className="num block font-semibold text-tint-foreground">{n.ncf_no}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{n.supplier_name} · {fmtDate(n.receipt_date)}</span>
                        </span>
                        <StatusBadge status={n.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {figures && !hasRole(user, ["NCF_APPROVER", "QC_INSPECTOR", "PURCHASING"]) && (
            <Card title="This year at a glance" action={<Link href="/reports" className="text-[12px]">Reports</Link>}>
              <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                {([["Raised", figures.kpi.raised], ["Closed", figures.kpi.closed], ["Waiting on supplier", figures.kpi.waiting], ["Void", figures.kpi.void]] as const).map(([k, v]) => (
                  <div key={k}><div className="text-xs font-medium text-muted-foreground">{k}</div><div className="num text-[20px] font-semibold">{v}</div></div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card title="Recent activity" action={<Link href="/notifications" className="text-[12px]">All notifications</Link>}>
          {notes.items.length === 0 ? <EmptyState icon={Bell} title="Nothing yet">You will see here when an NCF needs you.</EmptyState> : (
            <ul className="divide-y divide-border">
              {notes.items.map((n) => (
                <li key={n.id} className="flex gap-2.5 px-4 py-2.5">
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-muted" : "bg-primary"}`} />
                  <span className="min-w-0">
                    {n.ncf_id ? <Link href={`/ncf/${n.ncf_id}`} className="block text-[13px] text-foreground">{n.title}</Link> : <span className="block text-[13px]">{n.title}</span>}
                    <span className="num text-[11px] text-muted-foreground">{fmtDateTime(n.at)}{n.todo === true && <span className="font-sans"> · to do</span>}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
