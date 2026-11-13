import Link from "next/link";
import { redirect } from "next/navigation";
import { ClickableRow } from "@/components/clickable-row";
import { PageHead, Pager, paging, Shell, StatusBadge, TableCard, Tabs } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { selectedBu } from "@/lib/bu";
import { hasRole } from "@/lib/core";
import { DISPATCH_TABS, listDispatch, reminderWindow, type DispatchTab } from "@/lib/purchasing";
import { fmtDateTime } from "@/lib/util";

export default async function SupplierOutbox({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string; size?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, ["PURCHASING", "PCH_DIV_HEAD"])) redirect("/ncf");
  const sp = await searchParams;
  const tab = (DISPATCH_TABS.find((t) => t.key === sp.tab)?.key ?? "send") as DispatchTab;
  const { page, size } = paging(sp);
  const [{ rows, total }, window] = await Promise.all([listDispatch(user, tab, page, size, await selectedBu(user)), reminderWindow()]);
  return (
    <Shell>
      <PageHead title="Supplier Outbox" crumbs={[{ label: "Purchasing" }, { label: "Supplier Outbox" }]}
        sub="Export the form, email it to the supplier yourself, mark it sent, and mark it returned when their reply arrives. The response clock runs from sent to returned, in working days." />
      <Tabs label="Outbox" items={DISPATCH_TABS.map((t) => ({ href: `/outbox?tab=${t.key}`, label: t.label, active: t.key === tab }))} />

      <TableCard footer={<Pager total={total} page={page} size={size} base={{ tab }} />}>
        {/* Phones: one card per NCF, contacts tappable */}
        <ul className="divide-y divide-hairline md:hidden">
          {rows.length === 0 && <li className="px-4 py-8 text-center text-muted">Nothing here: no NCF is at this stage.</li>}
          {rows.map((r) => {
            const late = r.running && (r.working_days ?? 0) > window;
            return (
              <li key={r.id} className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/ncf/${r.id}`} className="num font-semibold">{r.ncf_no}</Link>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-[14px] font-medium">{r.supplier} <span className="num text-[12px] font-normal text-muted">{r.supplier_code}{r.po_no && ` · PO ${r.po_no}`}</span></div>
                <div className="text-[13px]">
                  {r.contacts.length === 0 && <span className="text-status-amber">No contact on file</span>}
                  {r.contacts.map((c, i) => (
                    <div key={i} className="break-words leading-snug">
                      <span className="font-medium">{c.name}</span>
                      {c.email && <> · <a href={`mailto:${c.email}`}>{c.email}</a></>}
                      {c.phone && <> · <a href={`tel:${c.phone}`} className="num">{c.phone}</a></>}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-muted">
                  <span className="num">
                    {r.sent_at ? `Sent ${fmtDateTime(r.sent_at)}` : "Not sent yet"}
                    {r.responded_at && ` · returned ${fmtDateTime(r.responded_at)}`}
                    {r.reminders > 0 && ` · ${r.reminders} reminder${r.reminders > 1 ? "s" : ""}`}
                  </span>
                  {r.working_days !== null && (
                    <span className={`num text-[13px] font-semibold ${late ? "text-status-red" : r.running ? "text-ink" : "text-status-emerald"}`}>
                      {r.working_days} wd{r.running ? " so far" : ""}{late && ` · over ${window}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <table className="table w-full max-md:hidden">
          <thead>
            <tr>
              <th scope="col">NCF</th>
              <th scope="col">Supplier</th>
              <th scope="col">Contacts</th>
              <th scope="col">Stage</th>
              <th scope="col">Sent</th>
              <th scope="col">Returned</th>
              <th scope="col" className="text-right">Response</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">Nothing here: no NCF is at this stage.</td></tr>}
            {rows.map((r) => {
              const late = r.running && (r.working_days ?? 0) > window;
              return (
                <ClickableRow key={r.id} href={`/ncf/${r.id}`}>
                  <td className="whitespace-nowrap">
                    <Link href={`/ncf/${r.id}`} className="num font-semibold">{r.ncf_no}</Link>
                    {r.po_no && <div className="num text-[12px] text-muted">PO {r.po_no}</div>}
                  </td>
                  <td>
                    <div className="font-medium">{r.supplier}</div>
                    <div className="num text-[12px] text-muted">{r.supplier_code}</div>
                  </td>
                  <td className="text-[13px]">
                    {r.contacts.length === 0 && <span className="text-status-amber">No contact on file</span>}
                    {r.contacts.map((c, i) => (
                      <div key={i} className="leading-snug">
                        <span className="font-medium">{c.name}</span>
                        {c.email && <> · <a href={`mailto:${c.email}`}>{c.email}</a></>}
                        {c.phone && <> · <span className="num">{c.phone}</span></>}
                      </div>
                    ))}
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num whitespace-nowrap">{r.sent_at ? fmtDateTime(r.sent_at) : <span className="font-sans text-muted">Not yet</span>}</td>
                  <td className="num whitespace-nowrap">
                    {r.responded_at ? fmtDateTime(r.responded_at) : r.sent_at ? <span className="font-sans text-muted">Waiting</span> : ""}
                    {r.reminders > 0 && <div className="font-sans text-[12px] text-muted">{r.reminders} reminder{r.reminders > 1 ? "s" : ""}</div>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {r.working_days !== null && (
                      <span className={`num font-semibold ${late ? "text-status-red" : r.running ? "text-ink" : "text-status-emerald"}`}>
                        {r.working_days} wd{r.running ? " so far" : ""}
                      </span>
                    )}
                    {late && <div className="text-[12px] text-status-red">over {window} wd</div>}
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </TableCard>
      <p className="text-[13px] text-muted">wd = working days (weekends and holidays in the calendar don&apos;t count).</p>
    </Shell>
  );
}
