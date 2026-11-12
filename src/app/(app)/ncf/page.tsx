import Link from "next/link";
import { Shell, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { listNcf } from "@/lib/ncf";
import { fmtDate } from "@/lib/util";

const TABS = [
  { key: "mine", label: "My drafts", role: ["QC_INSPECTOR"] },
  { key: "approve", label: "To approve", role: ["NCF_APPROVER"] },
  { key: "send", label: "To send", role: ["PURCHASING", "PCH_DIV_HEAD"] },
  { key: "waiting", label: "Waiting supplier", role: null },
  { key: "verify", label: "To verify and close", role: ["PURCHASING", "PCH_DIV_HEAD"] },
  { key: "closed", label: "Closed and void", role: null },
  { key: "all", label: "All", role: null },
] as const;

export default async function NcfList({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const tabs = TABS.filter((t) => !t.role || hasRole(user, [...t.role]));
  const { tab: asked } = await searchParams;
  const tab = tabs.find((t) => t.key === asked)?.key ?? tabs[0].key;
  const rows = await listNcf(user, tab);
  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Non Conformity Forms</h1>
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
            aria-current={t.key === tab ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-sm font-semibold no-underline ${
              t.key === tab ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
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
