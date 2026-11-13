import QRCode from "qrcode";
import type { NcfDetail } from "@/lib/ncf";
import { GOODS_STATUS } from "@/lib/labels";
import { appUrl, fmtDate, fmtDateTime } from "@/lib/util";

const B = "border-slate-900";

async function qrSvg(text: string, size = 60) {
  return QRCode.toString(text, { type: "svg", margin: 0, width: size, errorCorrectionLevel: "M" });
}

function Qr({ svg, label, href }: { svg: string; label: string; href: string }) {
  // On screen the QR is also a link; on paper it is scanned.
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block" aria-label={label}>
      <span role="img" aria-label={label} className="block" dangerouslySetInnerHTML={{ __html: svg }} />
    </a>
  );
}

type PrintMeta = { kind: "COPY" | "DRAFT" | "VOID"; copy: number; printedBy: string; printedAt: Date; external?: boolean };

/** The two-page A4 record (FD section 13). Page 2 is printed once the NCF has been sent. */
export async function PrintForm({ d, meta, pages }: { d: NcfDetail; meta: PrintMeta; pages: 1 | 2 }) {
  const docUrl = d.version ? `${appUrl()}/v/${d.version.verify_code}` : "";
  // Every copy, the supplier's included, carries live QR codes: anyone holding the paper or PDF can scan them to check
  // the number, version and signatures on the read-only /v pages. They lead to nothing else in the system.
  const docQr = d.version ? await qrSvg(docUrl) : null;
  const sigUrls = d.approvals.map((a) => (a.decision === "APPROVED" && a.verify_code ? `${appUrl()}/v/s/${a.verify_code}` : ""));
  const sigQrs = await Promise.all(sigUrls.map((u) => (u ? qrSvg(u, 46) : null)));
  const totals = d.items.reduce(
    (t, i) => ({ r: t.r + i.qty_received, s: t.s + i.qty_sample, c: t.c + i.qty_defect, x: t.x + i.qty_return }),
    { r: 0, s: 0, c: 0, x: 0 },
  );
  const files = d.evidence.filter((e) => e.capa_response_id === null && e.file_id);
  const kinds = new Set(d.evidence.filter((e) => e.capa_response_id === null).map((e) => e.kind));
  const poNos = d.po_no ?? [...new Set(d.items.map((i) => i.po_no).filter(Boolean))].join(", ");
  const rows = Math.max(5, d.items.length);
  const stamp = meta.kind === "COPY" ? null : meta.kind;

  const ctx: SheetCtx = { ncfNo: d.ncf_no, version: d.version?.version_no, docQr, docUrl, meta, pages, stamp };

  const sheet = "sheet relative mx-auto my-6 flex h-[1123px] w-[794px] flex-col gap-2 bg-white p-10 text-[13px] leading-snug text-slate-900 shadow-lg";

  return (
    <>
      <div className={sheet}>
        <Watermark ctx={ctx} />
        <div className={`flex min-h-0 flex-1 flex-col border ${B}`}>
          <Head ctx={ctx} part="Bagian 1 · Diisi Integra" />
          <div className={`grid shrink-0 grid-cols-2 border-b ${B}`}>
            <div className={`border-r ${B} px-2.5 py-1.5`}><b>BUSINESS UNIT:</b> {d.bu_name}</div>
            <div className="px-2.5 py-1.5"><b>Tanggal Buat:</b> {fmtDate(d.created_at)}</div>
          </div>
          <Band>IDENTIFIKASI MASALAH</Band>
          <div className="grid shrink-0 grid-cols-2">
            {[
              ["No. Komplain", d.ncf_no, "Tanggal Masuk", fmtDate(d.receipt_date)],
              ["Nama Supplier", d.supplier_name, "Tanggal Periksa", fmtDate(d.inspect_date)],
              ["No. SJ", d.sj_no ?? "", "Jam Periksa", d.inspect_time],
              ["Tanggal SJ", fmtDate(d.sj_date), "No. PO", poNos],
            ].map(([l1, v1, l2, v2]) => (
              <div key={l1} className="contents">
                <div className={`flex gap-1.5 border-b border-r ${B} px-2.5 py-1.5`}><span className="w-[110px] shrink-0 font-semibold">{l1}</span>: {v1}</div>
                <div className={`flex gap-1.5 border-b ${B} px-2.5 py-1.5`}><span className="w-[110px] shrink-0 font-semibold">{l2}</span>: {v2}</div>
              </div>
            ))}
          </div>
          <Band>PENYIMPANGAN YANG TERJADI</Band>
          <table className="w-full shrink-0 border-collapse">
            <thead>
              <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-slate-900 [&>th]:px-1.5 [&>th]:py-1 [&>th]:font-semibold [&>th:last-child]:border-r-0">
                <th className="w-[30px]">No</th>
                <th className="text-left">Nama Barang</th>
                <th className="w-[160px] text-left">Kode Barang</th>
                <th className="w-[62px] text-right leading-tight">Jumlah Datang</th>
                <th className="w-[62px] text-right leading-tight">Jumlah Sample</th>
                <th className="w-[62px] text-right leading-tight">Jumlah Cacat</th>
                <th className="w-[62px] text-right leading-tight">Qty Retur</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-b [&_td]:border-r [&_td]:border-slate-900 [&_td]:px-1.5 [&_td]:py-1 [&_td:last-child]:border-r-0">
              {Array.from({ length: rows }, (_, k) => d.items.at(k)).map((i, k) => (
                <tr key={k} className="h-[28px]">
                  <td className="text-center">{k + 1}</td>
                  <td>{i?.item_name}</td>
                  <td>{i?.item_code}</td>
                  <td className="text-right">{i?.qty_received}</td>
                  <td className="text-right">{i?.qty_sample}</td>
                  <td className="text-right">{i?.qty_defect}</td>
                  <td className="text-right">{i?.qty_return}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td />
                <td>Total</td>
                <td />
                <td className="text-right">{totals.r}</td>
                <td className="text-right">{totals.s}</td>
                <td className="text-right">{totals.c}</td>
                <td className="text-right">{totals.x}</td>
              </tr>
            </tbody>
          </table>
          <div className={`flex shrink-0 items-center gap-4 border-b ${B} px-2.5 py-2`}>
            <span className="text-[14px] font-bold">Status:</span>
            {Object.entries(GOODS_STATUS).map(([k, label]) => (
              <span key={k} className={`inline-flex items-center gap-1.5 ${d.goods_status === k ? "font-bold" : ""}`}>
                <span aria-hidden className={`inline-flex size-[14px] items-center justify-center border-[1.5px] ${B} text-[11px] leading-none`}>
                  {d.goods_status === k ? "✓" : ""}
                </span>
                {label}
              </span>
            ))}
          </div>
          <div className={`flex min-h-0 flex-1 border-b ${B}`}>
            <div className={`flex-1 border-r ${B}`}>
              <div className={`border-b ${B} py-1 text-center font-bold`}>Masalah yang Ditemukan</div>
              <div className="whitespace-pre-line p-2.5">
                <b>Kategori:</b> {d.problem_category}
                {"\n"}
                {d.problem_desc}
              </div>
            </div>
            <div className="flex-1">
              <div className={`border-b ${B} py-1 text-center font-bold`}>Tindak Lanjut dari Integra</div>
              <div className="whitespace-pre-line p-2.5">{d.follow_up}</div>
            </div>
          </div>
          <div className={`shrink-0 border-b ${B} px-2.5 py-1.5`}>
            <b>Keterangan konfirmasi (setelah 24 jam):</b> {d.goods_status === "HOLD" ? d.hold_note : "tidak berlaku"}
          </div>
          <div className={`flex shrink-0 items-center gap-4 border-b ${B} px-2.5 py-1.5`}>
            <b>Bukti di sistem:</b>
            {(["PHOTO", "VIDEO", "DOC", "NOTE"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={`inline-flex size-[14px] items-center justify-center border-[1.5px] ${B} text-[11px]`}>{kinds.has(k) ? "✓" : ""}</span>
                {{ PHOTO: "Foto", VIDEO: "Video", DOC: "Dokumen", NOTE: "Catatan" }[k]}
              </span>
            ))}
            <span className="ml-auto">Jumlah file: {files.length}</span>
          </div>
          <div className="grid shrink-0" style={{ gridTemplateColumns: `repeat(${Math.max(4, d.approvals.length)}, minmax(0, 1fr))` }}>
            {(d.approvals.length ? d.approvals : [null, null, null, null]).map((a, k) => (
              <div key={k} className={`flex flex-col ${k ? `border-l ${B}` : ""}`}>
                <div className={`border-b ${B} py-1 text-center text-[11.5px] font-semibold uppercase`}>{a?.title ?? "–"}</div>
                <div className="flex h-[78px] items-center gap-2 px-2">
                  {a?.decision === "APPROVED" ? (
                    <>
                      {sigQrs[k] && <Qr svg={sigQrs[k]!} href={sigUrls[k]} label={`QR tanda tangan ${a?.signer_name}`} />}
                      <span className="text-[11px] leading-tight">Disetujui secara elektronik<br />{fmtDateTime(a?.decided_at)}</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-slate-600">{a ? "Belum ditandatangani" : ""}</span>
                  )}
                </div>
                <div className="px-2 pb-1.5 text-[11px]">({a?.signer_name ?? "Nama"}) · {a?.signer_position ?? ""}</div>
              </div>
            ))}
          </div>
        </div>
        <Foot ctx={ctx} page={1} />
      </div>

      {pages === 2 && (
        <div className={sheet}>
          <Watermark ctx={ctx} />
          <div className={`flex min-h-0 flex-1 flex-col border ${B}`}>
            <Head ctx={ctx} part="Bagian 2 · Respons dan penutupan" />
            <div className={`grid shrink-0 grid-cols-2 border-b ${B}`}>
              <div className={`border-r ${B} px-2.5 py-1.5`}><b>No. Komplain:</b> {d.ncf_no}</div>
              <div className="px-2.5 py-1.5"><b>Nama Supplier:</b> {d.supplier_name}</div>
            </div>
            <Band>CORRECTIVE DAN PREVENTIVE · DIISI SUPPLIER</Band>
            <Box label="Akar masalah" value={d.capa?.received_via === "PURCHASING" ? "Lihat balasan supplier, tersimpan di VMS." : d.capa?.root_cause} />
            <Box label="Corrective action" value={d.capa?.corrective_action} sideLabel="Target selesai" side={fmtDate(d.capa?.target_date)} />
            <Box label="Preventive action" value={d.capa?.preventive_action} sideLabel="Berlaku mulai" side={fmtDate(d.capa?.effective_from)} />
            <div className={`grid shrink-0 grid-cols-2 border-b ${B}`}>
              <div className={`border-r ${B} px-2.5 py-1.5`}><b>Penanggung jawab supplier:</b> {d.capa?.responder_name}</div>
              <div className="px-2.5 py-1.5"><b>Jabatan:</b> {d.capa?.responder_position}</div>
            </div>
            <Band>JEJAK WAKTU · DICATAT SISTEM</Band>
            <table className="w-full shrink-0 border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-slate-900 [&_td]:px-2.5 [&_td]:py-1 [&_td:last-child]:border-r-0 [&_th]:border-b [&_th]:border-r [&_th]:border-slate-900 [&_th]:px-2.5 [&_th]:py-1 [&_th]:text-left [&_th:last-child]:border-r-0">
              <thead>
                <tr><th>Tahap</th><th className="w-[230px]">Tanggal dan jam</th><th className="w-[170px]">Oleh</th></tr>
              </thead>
              <tbody>
                {(
                  [
                    ["1. NCF dibuat", d.created_at, d.created_by_name],
                    ["2. Disetujui", d.approved_at, d.approvals.at(-1)?.signer_name],
                    ["3. Dikirim Integra ke supplier", d.request?.sent_at, d.request?.sent_by_name],
                    ["4. Balasan supplier diterima", d.request?.responded_at, d.capa?.received_via === "PURCHASING" ? d.capa.recorded_by_name : d.capa?.responder_name],
                    ["5. Closed", d.closed_at, d.closed_by_name],
                  ] as [string, Date | null | undefined, string | null | undefined][]
                ).map(([l, t, who]) => (
                  <tr key={l} className="h-[28px]"><td>{l}</td><td>{t ? fmtDateTime(t) : ""}</td><td>{t ? who : ""}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="shrink-0 px-2.5 py-2">
              <b>Waktu respons supplier:</b> {d.request?.response_working_days ?? "…"} hari kerja, dihitung dari tahap 3 sampai tahap 4.
            </div>
          </div>
          <Foot ctx={ctx} page={2} />
        </div>
      )}
    </>
  );
}

type SheetCtx = {
  ncfNo: string;
  version?: number;
  docQr: string | null;
  docUrl: string;
  meta: PrintMeta;
  pages: 1 | 2;
  stamp: string | null;
};

function Head({ ctx, part }: { ctx: SheetCtx; part: string }) {
  return (
    <div className={`flex h-[84px] shrink-0 border-b ${B}`}>
      <div className={`flex w-[180px] items-center justify-center border-r ${B} text-[17px] font-bold tracking-wide`}>INTEGRA GROUP</div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <h1 className="text-[24px] font-bold tracking-wide" style={{ fontFamily: "'Times New Roman', serif" }}>NON CONFORMITY FORM</h1>
        <span className="text-[12px] text-slate-700">No. {ctx.ncfNo} · Versi {ctx.version ?? "–"} · {part}</span>
      </div>
      <div className={`flex w-[150px] items-center gap-2 border-l ${B} px-2.5`}>
        {ctx.docQr ? (
          <Qr svg={ctx.docQr} href={ctx.docUrl} label="QR verifikasi dokumen" />
        ) : (
          <span className="flex size-[60px] shrink-0 items-center justify-center border border-dashed text-[11px]">QR</span>
        )}
        <span className="text-[11px] leading-tight">
          {ctx.meta.external && <b className="block text-[12px]">Salinan untuk supplier</b>}
          Pindai untuk cek keaslian
        </span>
      </div>
    </div>
  );
}

function Band({ children }: { children: React.ReactNode }) {
  return <div className={`shrink-0 border-b ${B} bg-slate-200 py-1 text-center text-[13px] font-bold`}>{children}</div>;
}

function Foot({ ctx, page }: { ctx: SheetCtx; page: number }) {
  return (
    <>
      <div className="flex shrink-0 justify-between gap-4 text-[11px] text-slate-700">
        <span>Tembusan: Purchasing · PPIC · Arsip QC Incoming Material</span>
        <span>FR/IG/ALL/IN/QUAC/007 – Rev.01 (draft)</span>
      </div>
      <div className="flex shrink-0 justify-between gap-4 text-[11px] text-slate-700">
        <span>
          Dicetak dari VMS {fmtDateTime(ctx.meta.printedAt)} oleh {ctx.meta.printedBy} · Cetakan ke-{ctx.meta.copy}. Rekaman resmi ada di sistem.
        </span>
        <span>Halaman {page} dari {ctx.pages}</span>
      </div>
    </>
  );
}

function Watermark({ ctx }: { ctx: SheetCtx }) {
  if (!ctx.stamp) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rotate-[-30deg] text-[120px] font-black text-slate-300/60">{ctx.stamp}</span>
    </div>
  );
}

function Box({ label, value, sideLabel, side, grow = 1 }: { label: string; value?: string | null; sideLabel?: string; side?: string; grow?: number }) {
  return (
    <div className={`flex min-h-0 border-b ${B}`} style={{ flex: `${grow} 1 0` }}>
      <div className={`flex-1 px-2.5 py-2 ${sideLabel ? `border-r ${B}` : ""}`}>
        <div className="font-semibold">{label}</div>
        <div className="mt-1 whitespace-pre-line">{value}</div>
      </div>
      {sideLabel && (
        <div className="w-[170px] px-2.5 py-2">
          <div className="font-semibold">{sideLabel}</div>
          <div className="mt-1">{side}</div>
        </div>
      )}
    </div>
  );
}
