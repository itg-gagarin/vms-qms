import { Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { PageHead, Pager, paging, Shell, StatusBadge, TableCard, Tabs } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canRead, hasRole, type Actor } from "@/lib/core";
import { countMrreg, searchMrreg, type ReceiptTab } from "@/lib/ncf";
import { fmtDate } from "@/lib/util";
import { createDraftAction } from "../actions";

type Row = Awaited<ReturnType<typeof searchMrreg>>[number];

export default async function NewNcf({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; size?: string; tab?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, "QC_INSPECTOR")) redirect("/ncf");
  const sp = await searchParams;
  const q = sp.q ?? "";
  const tab: ReceiptTab = sp.tab === "archive" ? "archive" : "open";
  const { page, size } = paging(sp);
  const [rows, total, other] = await Promise.all([
    searchMrreg(user, q, page, size, tab),
    countMrreg(user, q, tab),
    countMrreg(user, q, tab === "open" ? "archive" : "open"),
  ]);
  const counts = { open: tab === "open" ? total : other, archive: tab === "archive" ? total : other };
  const link = (t: ReceiptTab) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(t === "archive" ? { tab: t } : {}) })}`;
  const empty = tab === "open"
    ? "No open goods receipt matches. Receipts come from the SAP MRReg export; those with an NCF are in Archive."
    : "No goods receipt with an NCF matches.";

  return (
    <Shell>
      <PageHead title="SAP Goods Receipt"
        sub="Choose the goods receipt (MRReg) to raise an NCF. Once it has an NCF it moves to Archive. Supplier, No. SJ, dates and items come from SAP." />
      <form className="card flex flex-wrap items-end gap-3" role="search">
        {tab === "archive" && <input type="hidden" name="tab" value="archive" />}
        <div className="min-w-0 flex-[1_1_240px]">
          <label htmlFor="q" className="label">Search No. MRReg, No. SJ or supplier</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="MR-2026-10-0001" enterKeyHint="search" />
        </div>
        <button className="btn"><Search size={16} aria-hidden="true" /> Search</button>
      </form>
      <Tabs label="Goods receipts" items={[
        { href: link("open"), label: "Open", active: tab === "open", count: counts.open },
        { href: link("archive"), label: "Archive · has an NCF", active: tab === "archive", count: counts.archive },
      ]} />
      <TableCard footer={<Pager total={total} page={page} size={size} base={{ q: q || undefined, tab: tab === "archive" ? tab : undefined }} />}>
        {/* Phones: one card per receipt */}
        <ul className="divide-y divide-hairline md:hidden">
          {rows.length === 0 && <li className="px-4 py-8 text-center text-muted">{empty}</li>}
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num font-semibold">{r.mrreg_no}</div>
                  <div className="truncate text-[14px]">{r.supplier_name}</div>
                </div>
                <span className="num shrink-0 text-[13px] text-muted">{fmtDate(r.receipt_date)}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                <dt className="text-muted">No. SJ</dt><dd className="num min-w-0 break-all"><Sj sj={r.sj_no} /></dd>
                <dt className="text-muted">No. PO</dt><dd className="num min-w-0 break-all"><Pos r={r} /></dd>
                <dt className="text-muted">Lines</dt><dd className="num">{r.lines}</dd>
              </dl>
              <Ncfs r={r} user={user} />
              <div><Act r={r} tab={tab} full /></div>
            </li>
          ))}
        </ul>
        {/* Tablets and desktop: the table */}
        <table className="table w-full max-md:hidden">
          <thead>
            <tr>
              <th scope="col">No. MRReg</th>
              <th scope="col">Supplier</th>
              <th scope="col">No. SJ</th>
              <th scope="col">Tanggal Masuk</th>
              <th scope="col">No. PO</th>
              <th scope="col" className="text-right">Lines</th>
              {tab === "archive" && <th scope="col">NCF</th>}
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted">{empty}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-row-hover">
                <td className="num font-semibold">{r.mrreg_no}</td>
                <td>{r.supplier_name}</td>
                <td className="num"><Sj sj={r.sj_no} /></td>
                <td className="num">{fmtDate(r.receipt_date)}</td>
                <td className="num"><Pos r={r} /></td>
                <td className="num text-right">{r.lines}</td>
                {tab === "archive" && <td><Ncfs r={r} user={user} /></td>}
                <td className="text-right"><Act r={r} tab={tab} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <p className="text-[13px] text-muted">SAP is not connected yet. Receipts come from the SAP MRReg export loaded with npm run import:mrreg.</p>
    </Shell>
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
      {r.pos.map((p) => p.po_no).join(", ") || "–"}
      {r.pos.length > 1 && <div className="font-sans text-[12px] text-muted">{r.pos.length} POs: choose in the draft</div>}
    </>
  );
}

/** The NCFs already raised on the receipt. A number links only when the viewer's department may open that stage. */
function Ncfs({ r, user }: { r: Row; user: Actor }) {
  if (r.ncfs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {r.ncfs.map((n) => (
        <li key={n.id} className="flex flex-wrap items-center gap-2 text-[13px]">
          {canRead(user, r.bu_id, n.status) ? <Link href={`/ncf/${n.id}`} className="num font-semibold">{n.ncf_no}</Link> : <span className="num font-semibold">{n.ncf_no}</span>}
          <StatusBadge status={n.status} />
          {r.pos.length > 1 && n.po_no && <span className="num text-muted">PO {n.po_no}</span>}
        </li>
      ))}
    </ul>
  );
}

function Act({ r, tab, full }: { r: Row; tab: ReceiptTab; full?: boolean }) {
  if (r.sap_status === "CANCELED") return <span className="text-[13px] text-muted">Cancelled in SAP</span>;
  return (
    <ActionForm action={createDraftAction}>
      <input type="hidden" name="mrreg_id" value={r.id} />
      <Submit className={`btn ${full ? "h-11 w-full" : "h-8 px-3"}`}>{tab === "archive" ? "Create another NCF" : "Create NCF"}</Submit>
    </ActionForm>
  );
}
