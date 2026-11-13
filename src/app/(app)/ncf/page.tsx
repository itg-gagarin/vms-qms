import { Plus } from "lucide-react";
import Link from "next/link";
import { ClickableRow } from "@/components/clickable-row";
import { PageHead, Pager, paging, Shell, StatusBadge, TableCard, Tabs } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole, visibleStatuses, type Role } from "@/lib/core";
import { isNcfStatus, STATUS_LABEL, type NcfStatus } from "@/lib/labels";
import { countNcf, listNcf } from "@/lib/ncf";
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

export default async function NcfList({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; page?: string; size?: string }> }) {
  const user = await requireUser();
  const seen = visibleStatuses(user);
  const tabs = TABS.filter((t) => (!t.role || hasRole(user, t.role)) && (!t.statuses || t.statuses.some((x) => seen.includes(x))));
  const sp = await searchParams;
  // A status (from the sidebar) lists every NCF in that status the user may see; otherwise a worklist tab.
  const status = isNcfStatus(sp.status) && seen.includes(sp.status) ? sp.status : undefined;
  const tab = status ? "all" : (tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key);
  const { page, size } = paging(sp);
  const [rows, total] = await Promise.all([listNcf(user, tab, status, page, size), countNcf(user, tab, status)]);
  return (
    <Shell>
      <PageHead
        title={<>Non Conformity Forms{status && <span className="font-medium text-muted"> · {STATUS_LABEL[status]}</span>}</>}
        sub="Penyimpangan barang datang, dari pemeriksaan QC sampai CAPA supplier.">
        {hasRole(user, "QC_INSPECTOR") && <Link href="/ncf/new" className="btn btn-advance"><Plus size={16} aria-hidden="true" /> New NCF</Link>}
      </PageHead>
      <Tabs label="Worklist" items={tabs.map((t) => ({ href: `/ncf?tab=${t.key}`, label: t.label, active: !status && t.key === tab }))} />
      <TableCard footer={<Pager total={total} page={page} size={size} base={{ tab: status ? undefined : tab, status }} />}>
        <table className="table w-full min-w-[820px]">
          <thead>
            <tr>
              <th scope="col">No. Komplain</th>
              <th scope="col">Supplier</th>
              <th scope="col">No. PO</th>
              <th scope="col">Business Unit</th>
              <th scope="col">Tanggal Masuk</th>
              <th scope="col" className="text-right">Items</th>
              <th scope="col" className="text-right">Cacat</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted">No NCF here: nothing waits for you at this stage.</td></tr>}
            {rows.map((r) => (
              <ClickableRow key={r.id} href={`/ncf/${r.id}`}>
                <td><Link href={`/ncf/${r.id}`} className="num font-semibold">{r.ncf_no}</Link></td>
                <td>{r.supplier_name}</td>
                <td className="num">{r.po_no ?? <span className="font-sans text-muted">–</span>}</td>
                <td>{r.bu_name}</td>
                <td className="num">{fmtDate(r.receipt_date)}</td>
                <td className="num text-right">{r.items}</td>
                <td className="num text-right">{r.defects}</td>
                <td><StatusBadge status={r.status} /></td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </TableCard>
    </Shell>
  );
}
