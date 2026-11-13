import type { NcfDetail } from "@/lib/ncf";
import { GOODS_STATUS } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { Field, FieldGrid, Section } from "./ui";

/** Part 1 (sections A to F), read-only. Used on the internal page and the supplier page, so both look the same. */
export function NcfPart1({ d, fileHref }: { d: NcfDetail; fileHref: (fileId: number) => string }) {
  const totals = d.items.reduce(
    (t, i) => ({ r: t.r + i.qty_received, s: t.s + i.qty_sample, c: t.c + i.qty_defect, x: t.x + i.qty_return }),
    { r: 0, s: 0, c: 0, x: 0 },
  );
  const files = d.evidence.filter((e) => e.capa_response_id === null);
  const poNos = d.po_no ?? [...new Set(d.items.map((i) => i.po_no).filter(Boolean))].join(", ");
  return (
    <>
      <Section title="A. Identifikasi masalah">
        <FieldGrid cols={4}>
          <Field label="No. Komplain"><span className="num">{d.ncf_no}</span></Field>
          <Field label="Business Unit">{d.bu_name}</Field>
          <Field label="Nama Supplier">{d.supplier_name}</Field>
          <Field label="Kode Vendor"><span className="num">{d.supplier_code}</span></Field>
          <Field label="No. MRReg"><span className="num">{d.mrreg_no}</span></Field>
          <Field label="No. PO"><span className="num">{poNos}</span></Field>
          <Field label="No. SJ"><span className="num">{d.sj_no}</span></Field>
          <Field label="Tanggal SJ"><span className="num">{fmtDate(d.sj_date)}</span></Field>
          <Field label="Tanggal Masuk"><span className="num">{fmtDate(d.receipt_date)}</span></Field>
          <Field label="Tanggal Periksa"><span className="num">{fmtDate(d.inspect_date)}</span></Field>
          <Field label="Jam Periksa"><span className="num">{d.inspect_time}</span></Field>
        </FieldGrid>
      </Section>
      <Section title="B. Penyimpangan yang terjadi">
        <ItemTable d={d} totals={totals} />
      </Section>
      <Section title="C. Status barang">
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <Field label="Status">{d.goods_status ? GOODS_STATUS[d.goods_status] : ""}</Field>
          {d.goods_status === "HOLD" && <Field label="Keterangan konfirmasi (setelah 24 jam)">{d.hold_note}</Field>}
        </div>
      </Section>
      <Section title="D. Masalah yang ditemukan">
        <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          <Field label="Kategori masalah">{d.problem_category}</Field>
          <Field label="Uraian masalah">{d.problem_desc}</Field>
        </div>
      </Section>
      <Section title="E. Bukti" aside={`${files.filter((f) => f.file_id).length} file`}>
        <EvidenceList items={files} fileHref={fileHref} />
      </Section>
      <Section title="F. Tindak lanjut dari Integra">
        <p className="whitespace-pre-line text-[14px]">{d.follow_up || <span className="text-slate-500">–</span>}</p>
      </Section>
    </>
  );
}

export function ItemTable({ d, totals, children }: { d: NcfDetail; totals?: { r: number; s: number; c: number; x: number }; children?: (itemId: number) => React.ReactNode }) {
  const t = totals ?? d.items.reduce(
    (a, i) => ({ r: a.r + i.qty_received, s: a.s + i.qty_sample, c: a.c + i.qty_defect, x: a.x + i.qty_return }),
    { r: 0, s: 0, c: 0, x: 0 },
  );
  const pct = (c: number, s: number) => (s ? Math.round((c / s) * 100) : 0);
  return (
    <div className="rounded-sm border border-hairline">
      {/* Phones: one card per item, the four quantities side by side. No sideways scrolling. */}
      <ol className="divide-y divide-hairline md:hidden">
        {d.items.length === 0 && <li className="px-3 py-6 text-center text-muted">No items yet.</li>}
        {d.items.map((i, k) => (
          <li key={i.id} className="px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold leading-snug"><span className="num mr-1.5 text-muted">{k + 1}.</span>{i.item_name}</div>
                <div className="num break-all text-[12px] text-muted">{i.item_code}</div>
              </div>
              {children && <div className="-mr-2 -mt-2 shrink-0">{children(i.id)}</div>}
            </div>
            <Qty r={i.qty_received} s={i.qty_sample} c={i.qty_defect} x={i.qty_return} p={pct(i.qty_defect, i.qty_sample)} />
          </li>
        ))}
        {d.items.length > 1 && (
          <li className="bg-slate-50 px-3 py-3">
            <div className="font-semibold">Total</div>
            <Qty r={t.r} s={t.s} c={t.c} x={t.x} p={pct(t.c, t.s)} />
          </li>
        )}
      </ol>
      {/* Tablets and desktop: the form's table */}
      <table className="table w-full text-[14px] max-md:hidden [&_td]:px-2 [&_th]:px-2">
        <thead>
          <tr>
            <th scope="col">No</th>
            <th scope="col" className="min-w-[180px]">Nama Barang</th>
            <th scope="col">Kode Barang</th>
            <th scope="col" className="text-right">Jumlah Datang</th>
            <th scope="col" className="text-right">Jumlah Sample</th>
            <th scope="col" className="text-right">Jumlah Cacat</th>
            <th scope="col" className="text-right">% Cacat</th>
            <th scope="col" className="text-right">Qty Retur</th>
            {children && <th scope="col"><span className="sr-only">Action</span></th>}
          </tr>
        </thead>
        <tbody>
          {d.items.length === 0 && (
            <tr><td colSpan={children ? 9 : 8} className="py-6 text-center text-muted">No items yet.</td></tr>
          )}
          {d.items.map((i, k) => (
            <tr key={i.id}>
              <td>{k + 1}</td>
              <td>{i.item_name}</td>
              <td className="num whitespace-nowrap">{i.item_code}</td>
              <td className="num text-right">{i.qty_received}</td>
              <td className="num text-right">{i.qty_sample}</td>
              <td className="num text-right">{i.qty_defect}</td>
              <td className="num text-right">{pct(i.qty_defect, i.qty_sample)}%</td>
              <td className="num text-right">{i.qty_return}</td>
              {children && <td className="text-right">{children(i.id)}</td>}
            </tr>
          ))}
          {d.items.length > 0 && (
            <tr className="bg-slate-50 font-semibold">
              <td />
              <td>Total</td>
              <td />
              <td className="num text-right">{t.r}</td>
              <td className="num text-right">{t.s}</td>
              <td className="num text-right">{t.c}</td>
              <td className="num text-right">{pct(t.c, t.s)}%</td>
              <td className="num text-right">{t.x}</td>
              {children && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Qty({ r, s, c, x, p }: { r: number; s: number; c: number; x: number; p: number }) {
  return (
    <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
      {([["Datang", r], ["Sample", s], ["Cacat", `${c} · ${p}%`], ["Retur", x]] as const).map(([k, v]) => (
        <div key={k} className="rounded-xs bg-slate-50 px-1 py-1.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">{k}</dt>
          <dd className="num text-[14px] font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EvidenceList({
  items,
  fileHref,
  children,
}: {
  items: NcfDetail["evidence"];
  fileHref: (fileId: number) => string;
  children?: (evidenceId: number) => React.ReactNode;
}) {
  if (!items.length) return <p className="text-muted">No evidence yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline px-3 py-2">
          {e.file_id ? (
            <span>
              <a href={fileHref(e.file_id)} target="_blank" rel="noreferrer" className="font-semibold">
                {e.file_name}
              </a>{" "}
              <span className="text-sm text-muted">
                · {e.kind === "PHOTO" ? "Foto" : e.kind === "VIDEO" ? "Video" : "Dokumen"} · {Math.max(1, Math.round((e.bytes ?? 0) / 1024))} KB
              </span>
            </span>
          ) : (
            <span><span className="text-sm font-semibold text-muted">Catatan:</span> {e.caption}</span>
          )}
          {children?.(e.id)}
        </li>
      ))}
    </ul>
  );
}

/** Part 2 as read by Integra: CAPA, verification and the time trail (FD section 12). */
export function NcfPart2({ d, fileHref }: { d: NcfDetail; fileHref: (fileId: number) => string }) {
  const capaFiles = d.evidence.filter((e) => e.capa_response_id !== null);
  const steps: [string, Date | null | undefined, string | null | undefined][] = [
    ["NCF dibuat", d.created_at, d.created_by_name],
    ["Diajukan", d.firstSubmittedAt, d.created_by_name],
    ["Disetujui", d.approved_at, d.approvals.at(-1)?.decision === "APPROVED" ? d.approvals.at(-1)?.signer_name : null],
    ["Dikirim Integra ke supplier", d.request?.sent_at, d.request?.sent_by_name],
    // Older records sent by link also kept when the supplier first opened it.
    ...(d.request?.first_opened_at ? [["Dibuka supplier (link)", d.request.first_opened_at, d.supplier_name] as [string, Date, string]] : []),
    ["Balasan supplier diterima", d.request?.responded_at, d.capa?.received_via === "PURCHASING" ? d.capa.recorded_by_name : d.capa?.responder_name],
    ["Closed", d.closed_at, d.closed_by_name],
  ];
  const byEmail = d.capa?.received_via === "PURCHASING";
  return (
    <>
      <Section title="G. Corrective dan preventive dari supplier" aside={!d.capa ? "Belum ada balasan"
        : byEmail ? `Balasan lewat email · dicatat oleh ${d.capa.recorded_by_name}` : `Dijawab oleh ${d.capa.responder_name}, ${d.capa.responder_position}`}>
        {byEmail ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-700">The supplier&apos;s CAPA is in their reply, kept here as received.</p>
            {capaFiles.length > 0 && <EvidenceList items={capaFiles} fileHref={fileHref} />}
          </div>
        ) : d.capa ? (
          <div className="flex flex-col gap-4">
            <Field label="Akar masalah">{d.capa.root_cause}</Field>
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              <Field label="Corrective action">{d.capa.corrective_action}</Field>
              <Field label="Target selesai">{fmtDate(d.capa.target_date)}</Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              <Field label="Preventive action">{d.capa.preventive_action}</Field>
              <Field label="Berlaku mulai">{fmtDate(d.capa.effective_from)}</Field>
            </div>
            {capaFiles.length > 0 && <EvidenceList items={capaFiles} fileHref={fileHref} />}
          </div>
        ) : (
          <p className="text-muted">The supplier fills in Part 2 of the exported form and emails it back to Purchasing.</p>
        )}
      </Section>
      <Section title="Jejak waktu" aside="Dicatat sistem">
        <ol className="flex flex-col">
          {steps.map(([label, when, who]) => (
            <li key={label} className="flex flex-wrap justify-between gap-2 border-t border-hairline py-2 first:border-t-0">
              <span className="font-semibold">{label}</span>
              <span className="text-slate-700">{when ? `${fmtDateTime(when)}${who ? ` · ${who}` : ""}` : "–"}</span>
            </li>
          ))}
        </ol>
        {d.request?.response_working_days != null && (
          <p className="mt-3 text-sm text-slate-700">
            Waktu respons supplier: <strong>{d.request.response_working_days} hari kerja</strong> (dari dikirim sampai balasan diterima).
          </p>
        )}
        {d.reminders.length > 0 && (
          <p className="mt-2 text-sm text-slate-700">
            Reminders to Purchasing: {d.reminders.map((r) => `#${r.seq_no} ${fmtDateTime(r.sent_at)}`).join(" · ")}
          </p>
        )}
      </Section>
    </>
  );
}
