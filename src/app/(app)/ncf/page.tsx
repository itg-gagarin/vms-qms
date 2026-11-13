import { FileWarning, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { ClickableRow } from "@/components/clickable-row";
import { EmptyState, PageHead, Pager, paging, Shell, StatusBadge, TableCard, Tabs } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { selectedBu } from "@/lib/bu";
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

export default async function NcfList({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; page?: string; size?: string; q?: string }> }) {
  const user = await requireUser();
  const seen = visibleStatuses(user);
  const tabs = TABS.filter((t) => (!t.role || hasRole(user, t.role)) && (!t.statuses || t.statuses.some((x) => seen.includes(x))));
  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  // A status (from the sidebar) lists every NCF in that status the user may see; a search looks across all of them;
  // otherwise a worklist tab.
  const status = isNcfStatus(sp.status) && seen.includes(sp.status) ? sp.status : undefined;
  const tab = status || (term && !sp.tab) ? "all" : (tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key);
  const { page, size } = paging(sp);
  const bu = await selectedBu(user);
  const [rows, total, ...tabCounts] = await Promise.all([
    listNcf(user, tab, status, page, size, term, bu),
    countNcf(user, tab, status, term, bu),
    ...tabs.map((t) => countNcf(user, t.key, undefined, term, bu)),
  ]);
  const qs = (extra: Record<string, string | undefined>) =>
    `/ncf?${new URLSearchParams(Object.entries({ q: term || undefined, ...extra }).filter(([, v]) => v) as [string, string][])}`;
  const title = status ? STATUS_LABEL[status] : "Non Conformity Forms";

  return (
    <Shell>
      <PageHead title={title} crumbs={[{ label: "NCF Management", href: "/ncf" }, { label: status ? STATUS_LABEL[status] : "Worklist" }]}
        sub="Penyimpangan barang datang, dari pemeriksaan QC sampai balasan supplier.">
        {hasRole(user, "QC_INSPECTOR") && <Link href="/ncf/new" className="btn btn-advance"><Plus size={16} aria-hidden="true" /> New NCF</Link>}
      </PageHead>
      {!status && (
        <Tabs label="Worklist" items={tabs.map((t, i) => ({ href: qs({ tab: t.key }), label: t.label, active: t.key === tab, count: t.key === "all" ? undefined : (tabCounts[i] as number) }))} />
      )}
      <TableCard
        toolbar={
          <>
            <form action="/ncf" role="search" className="flex min-w-0 flex-1 items-center gap-2">
              {status && <input type="hidden" name="status" value={status} />}
              {!status && tab !== "all" && <input type="hidden" name="tab" value={tab} />}
              <div className="relative min-w-0 max-w-sm flex-1">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <label htmlFor="q" className="sr-only">Search</label>
                <input id="q" name="q" defaultValue={term} placeholder="No. Komplain, supplier, PO, MRReg" enterKeyHint="search" className="input h-9 pl-9 md:h-9" />
              </div>
              {term && <Link href={qs({ q: undefined, tab: status ? undefined : tab, status })} className="btn h-9 px-2.5 md:h-9" aria-label="Clear search"><X size={15} aria-hidden="true" /></Link>}
            </form>
            <span className="ml-auto text-[13px] text-muted"><span className="num text-ink">{total}</span> NCF{total === 1 ? "" : "s"}{term && <> matching &ldquo;{term}&rdquo;</>}</span>
          </>
        }
        footer={<Pager total={total} page={page} size={size} base={{ tab: status ? undefined : tab, status, q: term || undefined }} />}>
        {rows.length === 0 && (
          <EmptyState icon={FileWarning} title={term ? "No NCF matches the search" : "Nothing waits for you here"}>
            {term ? "Try the No. Komplain, a supplier name or vendor code, a PO or an MRReg number." : "NCFs at this stage for your department appear here."}
          </EmptyState>
        )}
        {/* Phones: each NCF is one tappable card */}
        {rows.length > 0 && (
          <ul className="divide-y divide-hairline md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/ncf/${r.id}`} className="block px-4 py-3 text-ink no-underline active:bg-row-hover hover:no-underline">
                  <span className="flex items-center justify-between gap-3">
                    <span className="num font-semibold text-tint-ink">{r.ncf_no}</span>
                    <StatusBadge status={r.status} />
                  </span>
                  <span className="mt-0.5 block truncate text-[14px]">{r.supplier_name}</span>
                  <span className="num mt-0.5 block text-[12px] text-muted">
                    {[r.po_no && `PO ${r.po_no}`, fmtDate(r.receipt_date), `${r.items} item${r.items === 1 ? "" : "s"}`, `${r.defects} cacat`].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <table className="table w-full max-md:hidden">
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
              {rows.map((r) => (
                <ClickableRow key={r.id} href={`/ncf/${r.id}`}>
                  <td><Link href={`/ncf/${r.id}`} className="num font-semibold">{r.ncf_no}</Link></td>
                  <td className="font-medium">{r.supplier_name}</td>
                  <td className="num">{r.po_no ?? <span className="font-sans text-muted">–</span>}</td>
                  <td className="text-slate-700">{r.bu_name}</td>
                  <td className="num">{fmtDate(r.receipt_date)}</td>
                  <td className="num text-right">{r.items}</td>
                  <td className="num text-right">{r.defects}</td>
                  <td><StatusBadge status={r.status} /></td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Shell>
  );
}
