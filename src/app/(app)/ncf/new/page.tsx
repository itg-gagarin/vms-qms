import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { searchMrreg } from "@/lib/ncf";
import { fmtDate } from "@/lib/util";
import { createDraftAction } from "../actions";

export default async function NewNcf({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, "QC_INSPECTOR")) redirect("/ncf");
  const { q = "" } = await searchParams;
  const rows = await searchMrreg(user, q);
  return (
    <Shell>
      <div>
        <h1 className="text-3xl font-bold">New NCF</h1>
        <p className="text-slate-600">
          Choose the goods receipt (MRReg). Supplier, No. SJ, Tanggal SJ, Tanggal Masuk and the items come from SAP.
        </p>
      </div>
      <form className="card flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-[260px] flex-1">
          <label htmlFor="q" className="label">Search No. MRReg, No. SJ or supplier</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="MR-2026-10-0001" />
        </div>
        <button className="btn">Search</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="table w-full min-w-[720px] text-[15px]">
          <thead>
            <tr>
              <th scope="col">No. MRReg</th>
              <th scope="col">Supplier</th>
              <th scope="col">No. SJ</th>
              <th scope="col">Tanggal Masuk</th>
              <th scope="col" className="text-right">Lines</th>
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-600">No MRReg found.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.mrreg_no}</td>
                <td>{r.supplier_name}</td>
                <td>
                  {r.sj_no.startsWith("?") ? (
                    <span title="Excel turned this SJ number into a date in the SAP export">{r.sj_no.slice(1)} <span className="text-xs text-amber-800">(check SJ)</span></span>
                  ) : r.sj_no}
                </td>
                <td>{fmtDate(r.receipt_date)}</td>
                <td className="text-right">{r.lines}</td>
                <td className="text-right">
                  {r.sap_status === "CANCELED" ? <span className="text-sm text-slate-600">Cancelled in SAP</span> : (
                  <ActionForm action={createDraftAction}>
                    <input type="hidden" name="mrreg_id" value={r.id} />
                    <Submit className="btn h-10">Create NCF</Submit>
                  </ActionForm>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-600">
        SAP is not connected in this MVP. Receipts come from the SAP MRReg export loaded with npm run import:mrreg.
      </p>
    </Shell>
  );
}
