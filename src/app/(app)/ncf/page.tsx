import Link from "next/link";
import { Shell, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole, visibleStatuses, type Role } from "@/lib/core";
import { listNcf } from "@/lib/ncf";
import { isNcfStatus, STATUS_LABEL, type NcfStatus } from "@/lib/labels";
import { fmtDate } from "@/lib/util";

// Worklist tabs. A tab shows only if the user may see at least one of its statuses (core.STATUSES_BY_ROLE).
const TABS: { key: string; label: string; role: Role[] | null; statuses: NcfStatus[] | null }[] = [
  { key: "mine", label: "My drafts", role: ["QC_INSPECTOR"], statuses: ["DRAFT", "WAITING_APPROVAL"] },
  { key: "approve", label: "To approve", role: ["NCF_APPROVER"], statuses: ["WAITING_APPROVAL"] },
  { key: "send", label: "To send", role: ["PURCHASING", "PCH_DIV_HEAD"], statuses: ["APPROVED"] },
  { key: "waiting", label: "Waiting supplier", role: null, statuses: ["SENT"] },
  { key: "verify", label: "To verify and close", role: ["PURCHASING", "PCH_DIV_HEAD"], statuses: ["RESPONDED"] },
  { key: "closed", label: "Closed and void", role: null, statuses: ["CLOSED", "VOID"] },
  { key: "all", label: "All", role: null, statuses: null },
];

export default async function NcfList({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const user = await requireUser();
  const seen = visibleStatuses(user);
  const tabs = TABS.filter((t) => (!t.role || hasRole(user, t.role)) && (!t.statuses || t.statuses.some((x) => seen.includes(x))));
  const { tab: asked, status: askedStatus } = await searchParams;
  // A status (from the sidebar) lists every NCF in that status the user may see; otherwise a worklist tab.
  const status = isNcfStatus(askedStatus) && seen.includes(askedStatus) ? askedStatus : undefined;
  const tab = status ? "all" : (tabs.find((t) => t.key === asked)?.key ?? tabs[0].key);
  const rows = await listNcf(user, tab, status);
  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">
            Non Conformity Forms{status && <span className="font-normal text-slate-500"> · {STATUS_LABEL[status]}</span>}
          </h1>
          <p className="text-slate-600">Penyimpangan barang datang, dari pemeriksaan QC sampai CAPA supplier.</p>
        </div>
        {hasRole(user, "QC_INSPECTOR") && (
          <Link href="/ncf/new" className="btn btn-primary no-underline">+ New NCF</Link>
        )}
      </div>
      <nav aria-label="Worklist" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/ncf?tab=${t.key}`}
            aria-current={!status && t.key === tab ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-sm font-semibold no-underline ${
              !status && t.key === tab ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="card overflow-x-auto p-0">
        <table className="table w-full min-w-[760px] text-[15px]">
          <thead>
            <tr>
              <th scope="col">No. Komplain</th>
              <th scope="col">Supplier</th>
              <th scope="col">Business Unit</th>
              <th scope="col">Tanggal Masuk</th>
              <th scope="col" className="text-right">Items</th>
              <th scope="col" className="text-right">Cacat</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-600">Nothing here.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="font-semibold">
                  <Link href={`/ncf/${r.id}`}>{r.ncf_no}</Link>
                </td>
                <td>{r.supplier_name}</td>
                <td>{r.bu_name}</td>
                <td>{fmtDate(r.receipt_date)}</td>
                <td className="text-right">{r.items}</td>
                <td className="text-right">{r.defects}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
