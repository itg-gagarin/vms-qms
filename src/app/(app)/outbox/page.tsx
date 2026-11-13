import Link from "next/link";
import { redirect } from "next/navigation";
import { ClickableRow } from "@/components/clickable-row";
import { Banner, Shell, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { DISPATCH_TABS, listDispatch, reminderWindow, type DispatchTab } from "@/lib/purchasing";
import { fmtDateTime } from "@/lib/util";
import { outbox } from "@/lib/verify";

export default async function SupplierOutbox({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, ["PURCHASING", "PCH_DIV_HEAD"])) redirect("/ncf");
  const { tab: asked, view } = await searchParams;
  const admin = hasRole(user, "SUPER_ADMIN");

  if (view === "queue" && admin) return <EmailQueue />;

  const tab = (DISPATCH_TABS.find((t) => t.key === asked)?.key ?? "send") as DispatchTab;
  const [rows, window] = await Promise.all([listDispatch(user, tab), reminderWindow()]);
  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Supplier Outbox</h1>
          <p className="text-slate-600">
            Generate the link, send the form to the supplier yourself, and mark it returned when their reply arrives. The response clock runs
            from the link to the reply, in working days.
          </p>
        </div>
        {admin && <Link href="/outbox?view=queue" className="text-sm font-semibold">System email queue →</Link>}
      </div>

      <nav aria-label="Outbox" className="flex flex-wrap gap-2">
        {DISPATCH_TABS.map((t) => (
          <Link key={t.key} href={`/outbox?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-sm font-semibold no-underline ${
              t.key === tab ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="card overflow-x-auto p-0">
        <table className="table w-full min-w-[880px] text-[14px]">
          <thead>
            <tr>
              <th scope="col">NCF</th>
              <th scope="col">Supplier</th>
              <th scope="col">Contacts</th>
              <th scope="col">Stage</th>
              <th scope="col">Link generated</th>
              <th scope="col">Returned</th>
              <th scope="col" className="text-right">Response</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-600">Nothing here.</td></tr>}
            {rows.map((r) => {
              const late = r.running && (r.working_days ?? 0) > window;
              return (
                <ClickableRow key={r.id} href={`/ncf/${r.id}`}>
                  <td className="whitespace-nowrap">
                    <Link href={`/ncf/${r.id}`} className="font-mono font-semibold">{r.ncf_no}</Link>
                    {r.po_no && <div className="text-xs text-slate-500">PO {r.po_no}</div>}
                  </td>
                  <td>
                    <div className="font-medium">{r.supplier}</div>
                    <div className="text-xs text-slate-500">{r.supplier_code}</div>
                  </td>
                  <td className="text-[13px]">
                    {r.contacts.length === 0 && <span className="text-amber-800">No contact on file</span>}
                    {r.contacts.map((c, i) => (
                      <div key={i} className="leading-snug">
                        <span className="font-medium">{c.name}</span>
                        {c.email && <> · <a href={`mailto:${c.email}`}>{c.email}</a></>}
                        {c.phone && <> · <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a></>}
                      </div>
                    ))}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.status === "RESPONDED" && r.received_via === "PURCHASING" && !r.reviewed && (
                      <div className="mt-1 text-xs font-semibold text-amber-800">CAPA to check</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-[13px]">{r.sent_at ? fmtDateTime(r.sent_at) : <span className="text-slate-500">Not yet</span>}</td>
                  <td className="whitespace-nowrap text-[13px]">
                    {r.responded_at ? fmtDateTime(r.responded_at) : r.sent_at ? <span className="text-slate-500">Waiting</span> : ""}
                    {r.reminders > 0 && <div className="text-xs text-slate-500">{r.reminders} reminder{r.reminders > 1 ? "s" : ""}</div>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {r.working_days === null ? "" : (
                      <span className={`font-semibold ${late ? "text-red-700" : r.running ? "text-slate-800" : "text-emerald-800"}`}>
                        {r.working_days} wd{r.running ? " so far" : ""}
                      </span>
                    )}
                    {late && <div className="text-xs text-red-700">over {window} wd</div>}
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-600">wd = working days (weekends and holidays in the calendar don&apos;t count). Sending by email from the system comes later.</p>
    </Shell>
  );
}

async function EmailQueue() {
  const rows = await outbox();
  return (
    <Shell>
      <Link href="/outbox" className="text-sm">← Supplier Outbox</Link>
      <h1 className="text-3xl font-bold">System email queue</h1>
      <Banner kind="info">
        SMTP is not connected yet. Every notification the system would send is queued here with its full text.
      </Banner>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <details key={r.id} className="card p-4">
            <summary className="flex cursor-pointer flex-wrap justify-between gap-2">
              <span className="font-semibold">{r.payload.subject}</span>
              <span className="text-sm text-slate-600">{r.event} · to {r.recipient} · {fmtDateTime(r.created)} · {r.status}</span>
            </summary>
            <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{r.payload.body}</pre>
          </details>
        ))}
        {rows.length === 0 && <p className="text-slate-600">No emails yet.</p>}
      </div>
    </Shell>
  );
}
