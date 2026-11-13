import { redirect } from "next/navigation";
import { BarList, ColumnChart, StatTile } from "@/components/charts";
import { Download } from "lucide-react";
import { Banner, PageHead, Pager, paging, Section, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { isNcfStatus, STATUS_LABEL, type NcfStatus } from "@/lib/labels";
import { dashboard, EXPORT_ROLES, REPORT_ROLES, supplierOptions, type ReportFilter } from "@/lib/reports";
import { AppError, wib } from "@/lib/util";

const ORDER: NcfStatus[] = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "SENT", "RESPONDED", "CLOSED", "VOID"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  if (!hasRole(user, REPORT_ROLES)) redirect("/ncf");
  const sp = await searchParams;
  const today = wib(new Date()).date;
  const filter: ReportFilter = {
    from: sp.from || `${today.slice(0, 4)}-01-01`,
    to: sp.to || today,
    status: isNcfStatus(sp.status) ? sp.status : undefined,
    supplierId: sp.supplier ? Number(sp.supplier) : undefined,
  };
  const suppliers = await supplierOptions(user);
  let data: Awaited<ReturnType<typeof dashboard>> | null = null;
  let error = "";
  try {
    data = await dashboard(user, filter);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  const canExport = hasRole(user, EXPORT_ROLES);
  const qs = new URLSearchParams(Object.entries({ from: filter.from, to: filter.to, status: filter.status ?? "", supplier: sp.supplier ?? "" }).filter(([, v]) => v));

  return (
    <Shell>
      <PageHead title="NCF Reports" sub="How fast suppliers reply, and how fast we approve and send. Response times count working days.">
        {canExport && <a href={`/api/ncf/export?${qs}`} className="btn"><Download size={16} aria-hidden="true" /> Export Excel</a>}
      </PageHead>

      {/* Filters in one row above the figures */}
      <form className="card flex flex-wrap items-end gap-3 p-4" role="search">
        <div><label htmlFor="from" className="label">From</label><input id="from" name="from" type="date" defaultValue={filter.from} className="input h-10" /></div>
        <div><label htmlFor="to" className="label">To</label><input id="to" name="to" type="date" defaultValue={filter.to} className="input h-10" /></div>
        <div className="min-w-[200px]">
          <label htmlFor="supplier" className="label">Supplier</label>
          <select id="supplier" name="supplier" defaultValue={sp.supplier ?? ""} className="input h-10">
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label htmlFor="status" className="label">Status</label>
          <select id="status" name="status" defaultValue={filter.status ?? ""} className="input h-10">
            <option value="">All statuses</option>
            {ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <button className="btn h-10">Apply</button>
        <p className="w-full text-xs text-slate-500">Period is the date the NCF was raised. Export uses the same filters.</p>
      </form>

      {error && <Banner kind="error">{error}</Banner>}
      {data && <Figures data={data} {...paging(sp)} base={Object.fromEntries(qs)} />}
    </Shell>
  );
}

function Figures({ data, page, size, base }: { data: Awaited<ReturnType<typeof dashboard>>; page: number; size: number; base: Record<string, string> }) {
  const { kpi, target } = data;
  const onTimePct = kpi.responded ? Math.round((100 * kpi.on_time) / kpi.responded) : null;
  const month = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
  const statusCount = new Map(data.byStatus.map((s) => [s.status, s.n]));
  return (
    <>
      <section className="grid gap-4 md:grid-cols-[1.2fr_2fr]" aria-label="Supplier responsiveness">
        <div className="flex flex-col justify-between gap-3 rounded-md border border-hairline border-t-[3px] border-t-advance bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Median supplier response</div>
          <div className="font-[family-name:var(--font-display)] text-[48px] font-semibold leading-none text-ink">
            {kpi.median_wd ?? "–"}<span className="ml-1 text-[18px] font-medium text-muted">working days</span>
          </div>
          <div className="text-[13px] text-muted">
            {kpi.responded} repl{kpi.responded === 1 ? "y" : "ies"} · average {kpi.avg_wd ?? "–"} wd
            {onTimePct !== null && <> · <span className="font-semibold text-ink">{onTimePct}%</span> within the {target}-day target</>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatTile label="NCFs raised" value={kpi.raised} sub={`${kpi.closed} closed · ${kpi.void} void`} />
          <StatTile label="Open now" value={kpi.open} sub="not closed or void" />
          <StatTile label="Waiting on supplier" value={kpi.waiting} tone={kpi.waiting_late ? "warn" : "default"}
            sub={kpi.waiting ? `${kpi.waiting_late} over ${target} wd · oldest ${kpi.oldest_wd} wd` : "none"} />
          <StatTile label="Approval time" value={kpi.approval_wd ?? "–"} sub="avg working days, submit → GM signed" />
          <StatTile label="Time to send" value={kpi.send_wd ?? "–"} sub="avg working days, approved → sent" />
          <StatTile label="Defect rate" value={kpi.defect_rate === null ? "–" : `${kpi.defect_rate}%`} sub="defects ÷ samples inspected" />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="NCFs raised per month">
          <ColumnChart label="NCFs raised per month" unit=""
            data={data.monthly.map((m) => ({ label: month(m.month), value: m.raised, title: `${month(m.month)}: ${m.raised} NCF${m.raised === 1 ? "" : "s"}` }))} />
        </Section>
        <Section title="Average supplier response per month" aside="working days, by month raised">
          <ColumnChart label="Average supplier response per month, working days" unit=" wd"
            data={data.monthly.map((m) => ({
              label: month(m.month), value: m.avg_wd,
              title: m.avg_wd === null ? `${month(m.month)}: no replies yet` : `${month(m.month)}: ${m.avg_wd} wd average over ${m.responded} repl${m.responded === 1 ? "y" : "ies"}`,
            }))} />
        </Section>
      </div>

      <Section title="Supplier responsiveness" aside={`longest delay first, unanswered included · target ${target} working days`}>
        <ul className="-mx-4 divide-y divide-hairline border-t border-hairline md:hidden">
          {data.suppliers.length === 0 && <li className="px-4 py-6 text-center text-muted">No NCFs in this period.</li>}
          {data.suppliers.slice((page - 1) * size, page * size).map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{s.name}</span>
                <span className={`num shrink-0 font-semibold ${s.avg_wd !== null && s.avg_wd > target ? "text-red-700" : ""}`}>{s.avg_wd === null ? "–" : `${s.avg_wd} wd avg`}</span>
              </div>
              <div className="num mt-0.5 text-[12px] text-muted">
                {s.ncfs} NCF · {s.responded} replied · slowest {s.max_wd === null ? "–" : `${s.max_wd} wd`}
                {s.responded ? ` · ${Math.round((100 * s.on_time) / s.responded)}% on target` : ""}
              </div>
              {s.waiting > 0 && (
                <div className={`num text-[12px] ${s.oldest_wait !== null && s.oldest_wait > target ? "font-semibold text-red-700" : "text-muted"}`}>
                  Waiting now: {s.waiting} · oldest {s.oldest_wait} wd
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="-mx-4 -mb-4 max-h-[70vh] overflow-auto max-md:hidden">
          <table className="table w-full text-[14px]">
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col" className="text-right">NCFs</th>
                <th scope="col" className="text-right">Replied</th>
                <th scope="col" className="text-right">Avg response</th>
                <th scope="col" className="text-right">Slowest</th>
                <th scope="col" className="text-right">Within target</th>
                <th scope="col" className="text-right">Waiting now</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.suppliers.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">No NCFs in this period.</td></tr>}
              {data.suppliers.slice((page - 1) * size, page * size).map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-right">{s.ncfs}</td>
                  <td className="text-right">{s.responded}</td>
                  <td className={`text-right font-semibold ${s.avg_wd !== null && s.avg_wd > target ? "text-red-700" : ""}`}>{s.avg_wd === null ? "–" : `${s.avg_wd} wd`}</td>
                  <td className="text-right">{s.max_wd === null ? "–" : `${s.max_wd} wd`}</td>
                  <td className="text-right">{s.responded ? `${Math.round((100 * s.on_time) / s.responded)}%` : "–"}</td>
                  <td className={`text-right ${s.oldest_wait !== null && s.oldest_wait > target ? "font-semibold text-red-700" : ""}`}>
                    {s.waiting ? `${s.waiting} · oldest ${s.oldest_wait} wd` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="-mx-4 -mb-4 mt-4"><Pager total={data.suppliers.length} page={page} size={size} base={base} /></div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="By status">
          <BarList rows={ORDER.filter((s) => statusCount.has(s)).map((s) => ({ key: STATUS_LABEL[s], label: STATUS_LABEL[s], value: statusCount.get(s)! }))} />
        </Section>
        <Section title="By problem category">
          <BarList rows={data.categories.map((c) => ({ key: c.name, label: c.name, value: c.n }))} />
        </Section>
      </div>
    </>
  );
}
