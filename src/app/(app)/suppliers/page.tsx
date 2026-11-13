import { Building, Plus, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClickableRow } from "@/components/clickable-row";
import { Modal } from "@/components/modal";
import { ModalForm } from "@/components/modal-form";
import { Submit } from "@/components/action-form";
import { EmptyState, PageHead, Pager, paging, Shell, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { listSuppliers, SUPPLIER_ROLES } from "@/lib/suppliers";
import { fmtDate } from "@/lib/util";
import { createSupplierAction } from "./actions";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; size?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, SUPPLIER_ROLES)) redirect("/ncf");
  const sp = await searchParams;
  const q = sp.q ?? "";
  const { page, size } = paging(sp);
  const { rows, total } = await listSuppliers(user, q, page, size);

  return (
    <Shell>
      <PageHead title="Supplier Master" crumbs={[{ label: "Purchasing" }, { label: "Supplier Master" }]}
        sub="Vendors from SAP, the people who receive NCFs, and how fast each supplier replies.">
        <Modal label="Add supplier" title="Add supplier" icon={<Plus size={16} aria-hidden="true" />} buttonClassName="btn btn-commit"
          description="For a vendor that is not in an SAP export yet. The vendor code must match SAP.">
          <ModalForm action={createSupplierAction} className="flex flex-col gap-4">
            <div>
              <label htmlFor="new-code" className="label">SAP vendor code</label>
              <input id="new-code" name="code" required minLength={3} maxLength={20} className="input num uppercase" placeholder="VLP00412" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="new-name" className="label">Supplier name</label>
              <input id="new-name" name="name" required minLength={2} className="input" placeholder="Name, PT" />
            </div>
            <div className="flex justify-end"><Submit className="btn btn-commit">Add supplier</Submit></div>
          </ModalForm>
        </Modal>
      </PageHead>

      <TableCard
        toolbar={
          <form className="flex w-full flex-wrap items-center gap-2" role="search">
            <div className="relative min-w-0 flex-[1_1_260px] sm:max-w-md">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <label htmlFor="q" className="sr-only">Search suppliers</label>
              <input id="q" name="q" defaultValue={q} className="input h-9 pl-9 md:h-9" placeholder="Name, vendor code, contact or email" enterKeyHint="search" />
            </div>
            <button className="btn h-9 md:h-9">Search</button>
            <span className="ml-auto text-[13px] text-muted"><span className="num text-ink">{total.toLocaleString("id-ID")}</span> supplier{total === 1 ? "" : "s"}</span>
          </form>
        }
        footer={<Pager total={total} page={page} size={size} base={{ q: q || undefined }} />}>
        {rows.length === 0 && <EmptyState icon={Building} title="No supplier matches">Vendors arrive with the SAP export; add one here only if it is not there yet.</EmptyState>}
        {rows.length > 0 && (
          <>
            <ul className="divide-y divide-hairline md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/suppliers/${r.id}`} className="block px-4 py-3 text-ink no-underline active:bg-row-hover hover:no-underline">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="num shrink-0 text-[12px] text-muted">{r.code}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-slate-700">{r.email ?? r.phone ?? <span className="text-status-amber">No contact</span>}</span>
                    <span className="num mt-0.5 block text-[12px] text-muted">
                      {r.ncfs} NCF{r.ncfs === 1 ? "" : "s"}{r.open_ncfs ? ` · ${r.open_ncfs} open` : ""}{r.avg_wd !== null ? ` · ${r.avg_wd} wd avg reply` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <table className="table w-full max-md:hidden">
              <thead>
                <tr>
                  <th scope="col">Vendor code</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">NCF contact</th>
                  <th scope="col" className="text-right">Contacts</th>
                  <th scope="col" className="text-right">NCFs</th>
                  <th scope="col" className="text-right">Open</th>
                  <th scope="col" className="text-right">Avg reply</th>
                  <th scope="col">Last NCF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ClickableRow key={r.id} href={`/suppliers/${r.id}`}>
                    <td className="num">{r.code}</td>
                    <td><Link href={`/suppliers/${r.id}`} className="font-medium">{r.name}</Link></td>
                    <td className="max-w-[260px] truncate text-[13px]">
                      {r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : r.phone ? <span className="num">{r.phone}</span> : <span className="text-status-amber">No contact</span>}
                    </td>
                    <td className="num text-right">{r.contacts}</td>
                    <td className="num text-right">{r.ncfs}</td>
                    <td className="num text-right">{r.open_ncfs || ""}</td>
                    <td className="num text-right">{r.avg_wd === null ? "–" : `${r.avg_wd} wd`}</td>
                    <td className="num">{r.last_ncf ? fmtDate(r.last_ncf) : "–"}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </>
        )}
      </TableCard>
    </Shell>
  );
}
