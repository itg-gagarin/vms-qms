import type { NcfDetail } from "@/lib/ncf";
import { GOODS_STATUS } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { Field, Section } from "./ui";

/** Part 1 (sections A to F), read-only. Used on the internal page and the supplier page, so both look the same. */
export function NcfPart1({ d, fileHref }: { d: NcfDetail; fileHref: (fileId: number) => string }) {
  const totals = d.items.reduce(
    (t, i) => ({ r: t.r + i.qty_received, s: t.s + i.qty_sample, c: t.c + i.qty_defect, x: t.x + i.qty_return }),
    { r: 0, s: 0, c: 0, x: 0 },
  );
  const files = d.evidence.filter((e) => e.capa_response_id === null);
  const poNos = [...new Set(d.items.map((i) => i.po_no).filter(Boolean))].join(", ");
  return (
    <>
      <Section title="A. Identifikasi masalah">
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <Field label="No. Komplain">{d.ncf_no}</Field>
          <Field label="Business Unit">{d.bu_name}</Field>
          <Field label="Nama Supplier">{d.supplier_name}</Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-4">
          <Field label="No. SJ">{d.sj_no}</Field>
          <Field label="Tanggal SJ">{fmtDate(d.sj_date)}</Field>
          <Field label="No. PO">{poNos}</Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-4">
          <Field label="Tanggal Masuk">{fmtDate(d.receipt_date)}</Field>
          <Field label="Tanggal Periksa">{fmtDate(d.inspect_date)}</Field>
          <Field label="Jam Periksa">{d.inspect_time}</Field>
        </div>
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
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <Field label="Kategori masalah">{d.problem_category}</Field>
          <div className="basis-full" />
          <Field label="Uraian masalah">{d.problem_desc}</Field>
        </div>
      </Section>
      <Section title="E. Bukti" aside={`${files.filter((f) => f.file_id).length} file`}>
        <EvidenceList items={files} fileHref={fileHref} />
      </Section>
      <Section title="F. Tindak lanjut dari Integra">
        <p className="whitespace-pre-line text-[15px]">{d.follow_up || <span className="text-slate-500">–</span>}</p>
      </Section>
    </>
  );
}

export function ItemTable({ d, totals, children }: { d: NcfDetail; totals?: { r: number; s: number; c: number; x: number }; children?: (itemId: number) => React.ReactNode }) {
  const t = totals ?? d.items.reduce(
    (a, i) => ({ r: a.r + i.qty_received, s: a.s + i.qty_sample, c: a.c + i.qty_defect, x: a.x + i.qty_return }),
    { r: 0, s: 0, c: 0, x: 0 },
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="table w-full min-w-[760px] text-[14px]">
        <thead>
          <tr>
            <th scope="col">No</th>
            <th scope="col">Nama Barang</th>
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
            <tr><td colSpan={children ? 9 : 8} className="py-6 text-center text-slate-600">No items yet.</td></tr>
          )}
          {d.items.map((i, k) => (
            <tr key={i.id}>
              <td>{k + 1}</td>
              <td>{i.item_name}</td>
              <td className="whitespace-nowrap">{i.item_code}</td>
              <td className="text-right">{i.qty_received}</td>
              <td className="text-right">{i.qty_sample}</td>
              <td className="text-right">{i.qty_defect}</td>
              <td className="text-right">{Math.round((i.qty_defect / i.qty_sample) * 100)}%</td>
              <td className="text-right">{i.qty_return}</td>
              {children && <td className="text-right">{children(i.id)}</td>}
            </tr>
          ))}
          {d.items.length > 0 && (
            <tr className="bg-slate-50 font-semibold">
              <td />
              <td>Total</td>
              <td />
              <td className="text-right">{t.r}</td>
              <td className="text-right">{t.s}</td>
              <td className="text-right">{t.c}</td>
              <td className="text-right">{t.s ? Math.round((t.c / t.s) * 100) : 0}%</td>
              <td className="text-right">{t.x}</td>
              {children && <td />}
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
  if (!items.length) return <p className="text-slate-600">No evidence yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
          {e.file_id ? (
            <span>
              <a href={fileHref(e.file_id)} target="_blank" rel="noreferrer" className="font-semibold">
                {e.file_name}
              </a>{" "}
              <span className="text-sm text-slate-600">
                · {e.kind === "PHOTO" ? "Foto" : e.kind === "VIDEO" ? "Video" : "Dokumen"} · {Math.max(1, Math.round((e.bytes ?? 0) / 1024))} KB
              </span>
            </span>
          ) : (
            <span><span className="text-sm font-semibold text-slate-600">Catatan:</span> {e.caption}</span>
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
    ["Dikirim Integra ke supplier", d.request?.sent_at, d.request?.sent_by_name ? `${d.request.sent_by_name} · ${d.request.send_method === "LINK" ? "link" : "email"}` : null],
    ["Diterima supplier (link dibuka)", d.request?.first_opened_at, d.supplier_name],
    ["Direspons supplier", d.request?.responded_at, d.capa?.responder_name],
    ["Closed", d.closed_at, d.closed_by_name],
  ];
  return (
    <>
      <Section title="G. Corrective dan preventive dari supplier" aside={d.capa ? `Dijawab oleh ${d.capa.responder_name}, ${d.capa.responder_position}` : "Belum ada respons"}>
        {d.capa ? (
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
          <p className="text-slate-600">The supplier fills this part through the link after the NCF is sent.</p>
        )}
      </Section>
      {d.closure_note && (
        <Section title="Verifikasi dan penutupan">
          <Field label="Hasil verifikasi">{d.closure_note}</Field>
        </Section>
      )}
      <Section title="Jejak waktu" aside="Dicatat sistem">
        <ol className="flex flex-col">
          {steps.map(([label, when, who]) => (
            <li key={label} className="flex flex-wrap justify-between gap-2 border-t border-slate-200 py-2 first:border-t-0">
              <span className="font-semibold">{label}</span>
              <span className="text-slate-700">{when ? `${fmtDateTime(when)}${who ? ` · ${who}` : ""}` : "–"}</span>
            </li>
          ))}
        </ol>
        {d.request?.response_working_days != null && (
          <p className="mt-3 text-sm text-slate-700">
            Waktu respons supplier: <strong>{d.request.response_working_days} hari kerja</strong> (dari dikirim sampai direspons).
          </p>
        )}
        {d.reminders.length > 0 && (
          <p className="mt-2 text-sm text-slate-700">
            Reminders: {d.reminders.map((r) => `#${r.seq_no} ${fmtDateTime(r.sent_at)}${r.to_supplier ? "" : " (Purchasing only)"}`).join(" · ")}
          </p>
        )}
      </Section>
    </>
  );
}
