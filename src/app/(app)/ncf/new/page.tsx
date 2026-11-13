import { Search } from "lucide-react";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { PageHead, Pager, paging, Shell, TableCard } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { countMrreg, searchMrreg } from "@/lib/ncf";
import { fmtDate } from "@/lib/util";
import { createDraftAction } from "../actions";

export default async function NewNcf({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; size?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, "QC_INSPECTOR")) redirect("/ncf");
  const sp = await searchParams;
  const q = sp.q ?? "";
  const { page, size } = paging(sp);
  const [rows, total] = await Promise.all([searchMrreg(user, q, page, size), countMrreg(user, q)]);
  return (
    <Shell>
      <PageHead title="SAP Goods Receipt"
        sub="Choose the goods receipt (MRReg) to raise an NCF. If it holds several POs of the same supplier, you choose the PO in the draft. Supplier, No. SJ, dates and items come from SAP." />
      <form className="card flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-[260px] flex-1">
          <label htmlFor="q" className="label">Search No. MRReg, No. SJ or supplier</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="MR-2026-10-0001" />
        </div>
        <button className="btn"><Search size={16} aria-hidden="true" /> Search</button>
      </form>
      <TableCard footer={<Pager total={total} page={page} size={size} base={{ q: q || undefined }} />}>
        <table className="table w-full min-w-[820px]">
          <thead>
            <tr>
              <th scope="col">No. MRReg</th>
              <th scope="col">Supplier</th>
              <th scope="col">No. SJ</th>
              <th scope="col">Tanggal Masuk</th>
              <th scope="col">No. PO</th>
              <th scope="col" className="text-right">Lines</th>
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">No goods receipt matches. Receipts come from the SAP MRReg export.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-row-hover">
                <td className="num font-semibold">{r.mrreg_no}</td>
                <td>{r.supplier_name}</td>
                <td className="num">
                  {r.sj_no.startsWith("?") ? (
                    <span title="Excel turned this SJ number into a date in the SAP export">{r.sj_no.slice(1)} <span className="font-sans text-[12px] text-status-amber">(check SJ)</span></span>
                  ) : r.sj_no}
                </td>
                <td className="num">{fmtDate(r.receipt_date)}</td>
                <td className="num">
                  {r.pos.map((p) => p.po_no).join(", ") || "–"}
                  {r.pos.length > 1 && <div className="font-sans text-[12px] text-muted">{r.pos.length} POs: choose in the draft</div>}
                </td>
                <td className="num text-right">{r.lines}</td>
                <td className="text-right">
                  {r.sap_status === "CANCELED" ? <span className="text-[13px] text-muted">Cancelled in SAP</span> : (
                    <ActionForm action={createDraftAction}>
                      <input type="hidden" name="mrreg_id" value={r.id} />
                      <Submit className="btn h-8 px-3">Create NCF</Submit>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <p className="text-[13px] text-muted">SAP is not connected yet. Receipts come from the SAP MRReg export loaded with npm run import:mrreg.</p>
    </Shell>
  );
}
