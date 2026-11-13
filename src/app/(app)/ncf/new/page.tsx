import { ClipboardCheck, Search } from "lucide-react";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { EmptyState, PageHead, Pager, paging, Shell, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { selectedBu } from "@/lib/bu";
import { hasRole } from "@/lib/core";
import { countMrreg, searchMrreg } from "@/lib/ncf";
import { fmtDate } from "@/lib/util";
import { createDraftAction } from "../actions";

type Row = Awaited<ReturnType<typeof searchMrreg>>[number];

const qtyFmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("id-ID", { maximumFractionDigits: 3 }));

// Open goods receipts only: a receipt with an NCF, or cancelled in SAP, is not listed (see ncf.receiptWhere).
export default async function NewNcf({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; size?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, "QC_INSPECTOR")) redirect("/ncf");
  const sp = await searchParams;
  const q = sp.q ?? "";
  const { page, size } = paging(sp);
  const bu = await selectedBu(user);
  const [rows, total] = await Promise.all([searchMrreg(user, q, page, size, bu), countMrreg(user, q, bu)]);

  return (
    <Shell>
      <PageHead title="SAP Goods Receipt" crumbs={[{ label: "NCF Management", href: "/ncf" }, { label: "SAP Goods Receipt" }]}
        sub="Open goods receipts (MRReg) from SAP. Raise an NCF from a receipt; once it has one it leaves this list." />
      <TableCard
        toolbar={
          <form className="flex w-full flex-wrap items-center gap-2" role="search">
            <div className="relative min-w-0 flex-[1_1_260px] sm:max-w-md">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <label htmlFor="q" className="sr-only">Search receipts</label>
              <input id="q" name="q" defaultValue={q} className="input h-9 pl-9 md:h-9" placeholder="MRReg, vendor, vendor code, PO, item, SJ" enterKeyHint="search" />
            </div>
            <button className="btn h-9 md:h-9">Search</button>
            <span className="ml-auto text-[13px] text-muted"><span className="num text-ink">{total.toLocaleString("id-ID")}</span> open receipt{total === 1 ? "" : "s"}</span>
          </form>
        }
        footer={<Pager total={total} page={page} size={size} base={{ q: q || undefined }} />}>
        {rows.length === 0 && (
          <EmptyState icon={ClipboardCheck} title={q ? "No open receipt matches" : "No open goods receipt"}>
            Receipts that already have an NCF, or were cancelled in SAP, are not listed.
          </EmptyState>
        )}
        {/* Phones: one card per receipt */}
        {rows.length > 0 && (
          <ul className="divide-y divide-hairline md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="num font-semibold">{r.mrreg_no}</div>
                    <div className="truncate text-[14px]">{r.supplier_name} <span className="num text-[12px] text-muted">{r.vendor_code}</span></div>
                  </div>
                  <span className="num shrink-0 text-[12px] text-muted">{fmtDate(r.receipt_date)}</span>
                </div>
                <Items r={r} />
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                  <dt className="text-muted">No. PO</dt><dd className="num min-w-0 break-all"><Pos r={r} /></dd>
                  <dt className="text-muted">No. SJ</dt><dd className="num min-w-0 break-all"><Sj sj={r.sj_no} /> · {fmtDate(r.sj_date)}</dd>
                  <dt className="text-muted">Qty Reg</dt><dd className="num">{qtyFmt(r.qty_reg)}</dd>
                </dl>
                <div><Act r={r} full /></div>
              </li>
            ))}
          </ul>
        )}
        {/* Tablets and desktop: the export's columns */}
        {rows.length > 0 && (
          <table className="table w-full max-md:hidden">
            <thead>
              <tr>
                <th scope="col" title="No. MRReg and Registration Date">MRReg</th>
                <th scope="col">Vendor</th>
                <th scope="col">Item</th>
                <th scope="col">PO</th>
                <th scope="col" className="text-right" title="Qty Reg">Qty</th>
                <th scope="col">Surat Jalan</th>
                <th scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-row-hover">
                  <td>
                    <div className="num font-semibold">{r.mrreg_no}</div>
                    <div className="num text-[12px] text-muted" title="Registration Date (Tanggal Masuk)">{fmtDate(r.receipt_date)}</div>
                  </td>
                  <td>
                    <div className="max-w-[170px] truncate font-medium 2xl:max-w-[240px]" title={r.supplier_name}>{r.supplier_name}</div>
                    <div className="num text-[12px] text-muted">{r.vendor_code}</div>
                  </td>
                  <td><div className="w-[220px] xl:w-[280px] 2xl:w-[340px]"><Items r={r} /></div></td>
                  <td className="num"><Pos r={r} /></td>
                  <td className="num text-right">{qtyFmt(r.qty_reg)}</td>
                  <td>
                    <div className="num"><Sj sj={r.sj_no} /></div>
                    <div className="num text-[12px] text-muted" title="Tanggal Surat Jalan">{fmtDate(r.sj_date)}</div>
                  </td>
                  <td className="text-right"><Act r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Shell>
  );
}

/** The receipt's items: the first one in full, the rest folded behind "+N more". */
function Items({ r }: { r: Row }) {
  const [first, ...rest] = r.items;
  if (!first) return <span className="text-muted">–</span>;
  const line = (i: Row["items"][number]) => (
    <>
      <div className="truncate text-[13px] font-medium" title={i.item_name}>{i.item_name}</div>
      <div className="num truncate text-[11px] text-muted">
        {i.item_code}{i.item_group && <span className="font-sans"> · {i.item_group}</span>} · reg {qtyFmt(i.qty_reg)}
        {i.qty_po !== null && <> / PO {qtyFmt(i.qty_po)}</>}
      </div>
    </>
  );
  return (
    <div className="min-w-0">
      {line(first)}
      {rest.length > 0 && (
        <details className="mt-1 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none text-[12px] font-medium text-tint-ink hover:underline">+{rest.length} more item{rest.length > 1 ? "s" : ""}</summary>
          <div className="mt-1 flex flex-col gap-1.5 border-l border-hairline pl-2">
            {rest.map((i, k) => <div key={k}>{line(i)}</div>)}
          </div>
        </details>
      )}
    </div>
  );
}

function Sj({ sj }: { sj: string }) {
  return sj.startsWith("?") ? (
    <span title="Excel turned this SJ number into a date in the SAP export">{sj.slice(1)} <span className="font-sans text-[12px] text-status-amber">(check SJ)</span></span>
  ) : <>{sj}</>;
}

function Pos({ r }: { r: Row }) {
  return (
    <>
      {r.pos.map((p) => <div key={p.id}>{p.po_no}</div>)}
      {r.pos.length === 0 && "–"}
      {r.pos.length > 1 && <div className="font-sans text-[11px] text-muted">{r.pos.length} POs: choose in the draft</div>}
    </>
  );
}

function Act({ r, full }: { r: Row; full?: boolean }) {
  return (
    <ActionForm action={createDraftAction}>
      <input type="hidden" name="mrreg_id" value={r.id} />
      <Submit className={`btn whitespace-nowrap ${full ? "h-11 w-full" : "h-8 px-3 md:h-8"}`}>Create NCF</Submit>
    </ActionForm>
  );
}
