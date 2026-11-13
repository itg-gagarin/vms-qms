import { ClipboardCheck, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { EmptyState, PageHead, Pager, paging, Shell, StatePill, StatusBadge, TableCard, Tabs } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canRead, hasRole, type Actor } from "@/lib/core";
import { countMrreg, SAP_STATUSES, searchMrreg, type ReceiptTab, type SapStatus } from "@/lib/ncf";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { createDraftAction } from "../actions";

type Row = Awaited<ReturnType<typeof searchMrreg>>[number];

const SAP_TONE: Record<string, "amber" | "indigo" | "emerald" | "red" | "slate"> = { OPEN: "amber", CONFIRMED: "indigo", CLOSED: "emerald", CANCELED: "red" };
const SAP_LABEL: Record<string, string> = { OPEN: "Open", CONFIRMED: "Confirmed", CLOSED: "Closed", CANCELED: "Canceled" };
const qtyFmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("id-ID", { maximumFractionDigits: 3 }));

export default async function NewNcf({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; size?: string; tab?: string; sap?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, "QC_INSPECTOR")) redirect("/ncf");
  const sp = await searchParams;
  const q = sp.q ?? "";
  const tab: ReceiptTab = sp.tab === "archive" ? "archive" : "open";
  const sap = (SAP_STATUSES as readonly string[]).includes(sp.sap ?? "") ? (sp.sap as SapStatus) : undefined;
  const { page, size } = paging(sp);
  const [rows, total, other] = await Promise.all([
    searchMrreg(user, q, page, size, tab, sap),
    countMrreg(user, q, tab, sap),
    countMrreg(user, q, tab === "open" ? "archive" : "open", sap),
  ]);
  const counts = { open: tab === "open" ? total : other, archive: tab === "archive" ? total : other };
  const base = { q: q || undefined, sap };
  const link = (t: ReceiptTab) => `?${new URLSearchParams(Object.entries({ ...base, tab: t === "archive" ? t : undefined }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <Shell>
      <PageHead title="SAP Goods Receipt" crumbs={[{ label: "NCF Management", href: "/ncf" }, { label: "SAP Goods Receipt" }]}
        sub="Goods receipts (MRReg) from the SAP export. Raise an NCF from a receipt; once it has one it moves to Archive." />
      <Tabs label="Goods receipts" items={[
        { href: link("open"), label: "Open", active: tab === "open", count: counts.open },
        { href: link("archive"), label: "Archive · has an NCF", active: tab === "archive", count: counts.archive },
      ]} />
      <TableCard
        toolbar={
          <form className="flex w-full flex-wrap items-center gap-2" role="search">
            {tab === "archive" && <input type="hidden" name="tab" value="archive" />}
            <div className="relative min-w-0 flex-[1_1_260px] sm:max-w-md">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <label htmlFor="q" className="sr-only">Search receipts</label>
              <input id="q" name="q" defaultValue={q} className="input h-9 pl-9 md:h-9" placeholder="MRReg, vendor, vendor code, PO, item, SJ" enterKeyHint="search" />
            </div>
            <label htmlFor="sap" className="sr-only">SAP status</label>
            <select id="sap" name="sap" defaultValue={sap ?? ""} className="input h-9 w-auto md:h-9">
              <option value="">All SAP statuses</option>
              {SAP_STATUSES.map((s) => <option key={s} value={s}>{SAP_LABEL[s]}</option>)}
            </select>
            <button className="btn h-9 md:h-9">Apply</button>
            <span className="ml-auto text-[13px] text-muted"><span className="num text-ink">{total.toLocaleString("id-ID")}</span> receipt{total === 1 ? "" : "s"}</span>
          </form>
        }
        footer={<Pager total={total} page={page} size={size} base={{ ...base, tab: tab === "archive" ? tab : undefined }} />}>
        {rows.length === 0 && (
          <EmptyState icon={ClipboardCheck} title={tab === "open" ? "No open goods receipt matches" : "No receipt with an NCF matches"}>
            {tab === "open" ? "Receipts that already have an NCF are in Archive." : "Receipts move here once an NCF is raised on them."}
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
                  {r.sap_status && <StatePill tone={SAP_TONE[r.sap_status] ?? "slate"}>{SAP_LABEL[r.sap_status] ?? r.sap_status}</StatePill>}
                </div>
                <Items r={r} />
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                  <dt className="text-muted">No. PO</dt><dd className="num min-w-0 break-all"><Pos r={r} /></dd>
                  <dt className="text-muted">No. SJ</dt><dd className="num min-w-0 break-all"><Sj sj={r.sj_no} /> · {fmtDate(r.sj_date)}</dd>
                  <dt className="text-muted">Registrasi</dt><dd className="num">{fmtDate(r.receipt_date)}{r.sap_closed_at && <span className="text-muted"> · SAP closed {fmtDate(r.sap_closed_at)}</span>}</dd>
                  <dt className="text-muted">Qty Reg</dt><dd className="num">{qtyFmt(r.qty_reg)}</dd>
                </dl>
                <Ncfs r={r} user={user} />
                <div><Act r={r} tab={tab} full /></div>
              </li>
            ))}
          </ul>
        )}
        {/* Tablets and desktop: the export's columns */}
        {rows.length > 0 && (
          <table className="table w-full max-md:hidden">
            <thead>
              <tr>
                <th scope="col">No. MRReg · Registrasi</th>
                <th scope="col">Vendor</th>
                <th scope="col">Item</th>
                <th scope="col">No. PO</th>
                <th scope="col" className="text-right">Qty Reg</th>
                <th scope="col">Surat Jalan</th>
                <th scope="col">SAP</th>
                {tab === "archive" && <th scope="col">NCF</th>}
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
                  <td className="max-w-[200px]">
                    <div className="truncate font-medium" title={r.supplier_name}>{r.supplier_name}</div>
                    <div className="num text-[12px] text-muted">{r.vendor_code}</div>
                  </td>
                  <td className="min-w-[200px] max-w-[300px]"><Items r={r} /></td>
                  <td className="num"><Pos r={r} /></td>
                  <td className="num text-right">{qtyFmt(r.qty_reg)}</td>
                  <td>
                    <div className="num"><Sj sj={r.sj_no} /></div>
                    <div className="num text-[12px] text-muted" title="Tanggal Surat Jalan">{fmtDate(r.sj_date)}</div>
                  </td>
                  <td>
                    {/* Create, Confirm and Close dates from the export, on hover */}
                    <span title={[r.sap_created_at && `Created ${fmtDateTime(r.sap_created_at)}`, r.confirmed_on && `Confirmed ${fmtDate(r.confirmed_on)}`,
                      r.sap_closed_at && `Closed ${fmtDateTime(r.sap_closed_at)}`].filter(Boolean).join(" · ")}>
                      {r.sap_status ? <StatePill tone={SAP_TONE[r.sap_status] ?? "slate"}>{SAP_LABEL[r.sap_status] ?? r.sap_status}</StatePill> : "–"}
                    </span>
                  </td>
                  {tab === "archive" && <td><Ncfs r={r} user={user} /></td>}
                  <td className="text-right"><Act r={r} tab={tab} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      <p className="text-[13px] text-muted">SAP is not connected yet. Receipts come from the SAP MRReg export loaded with npm run import:mrreg.</p>
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
      <Submit className={`btn whitespace-nowrap ${full ? "h-11 w-full" : "h-8 px-3 md:h-8"}`}>{tab === "archive" ? "Create another NCF" : "Create NCF"}</Submit>
    </ActionForm>
  );
}
