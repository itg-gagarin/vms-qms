import type { Metadata } from "next";
import { ActionForm, Submit } from "@/components/action-form";
import { NcfPart1, NcfPart2 } from "@/components/ncf-document";
import { Banner, Shell } from "@/components/ui";
import { openForSupplier } from "@/lib/supplier";
import { AppError, fmtDateTime } from "@/lib/util";
import { respondAction } from "./actions";

export const metadata: Metadata = { title: "NCF response – Integra Group", robots: { index: false } };

export default async function SupplierPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data;
  try {
    data = await openForSupplier(token);
  } catch (e) {
    if (e instanceof AppError) {
      return (
        <Shell>
          <Header />
          <Banner kind="error">{e.message}</Banner>
        </Shell>
      );
    }
    throw e;
  }
  const { ncf: d, canRespond } = data;
  const fileHref = (f: number) => `/api/s/${token}/files/${f}`;
  return (
    <>
      <Header />
      <Shell>
        <div>
          <p className="font-semibold">NCF No. {d.ncf_no}</p>
          <h1 className="text-3xl font-bold">Non Conformity Form</h1>
          <p className="mt-1 max-w-3xl text-slate-700">
            Kepada {d.supplier_name}. Integra Group menemukan penyimpangan pada barang yang Anda kirim (SJ {d.sj_no}). Mohon isi
            corrective dan preventive action di bagian G.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Dikirim {fmtDateTime(d.request?.sent_at)}. <a href={`/s/${token}/print`} target="_blank" rel="noreferrer">Print Page 1 for your records</a>
          </p>
        </div>
        {!canRespond && d.capa && (
          <Banner kind="ok">
            Terima kasih. Respons Anda sudah kami terima pada {fmtDateTime(d.capa.submitted_at)}.{" "}
            <a href={`/s/${token}/print`} target="_blank" rel="noreferrer">Print the form with your answer</a>
          </Banner>
        )}
        <NcfPart1 d={d} fileHref={fileHref} />
        {canRespond ? (
          <section className="card border-2 border-brand" aria-label="Your response">
            <h2 className="h2">G. Corrective dan preventive dari supplier</h2>
            <p className="mt-1 text-sm text-slate-600">Semua kolom wajib kecuali lampiran. Setelah dikirim, respons tidak bisa diubah.</p>
            <ActionForm action={respondAction} className="mt-4 flex flex-col gap-4">
              <input type="hidden" name="token" value={token} />
              <div>
                <label htmlFor="root_cause" className="label">Akar masalah</label>
                <textarea id="root_cause" name="root_cause" rows={3} required className="input" placeholder="Mengapa penyimpangan ini terjadi?" />
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="min-w-[280px] flex-[3_1_280px]">
                  <label htmlFor="corrective_action" className="label">Corrective action</label>
                  <textarea id="corrective_action" name="corrective_action" rows={3} required className="input" placeholder="Perbaikan untuk barang pada NCF ini" />
                </div>
                <div className="min-w-[180px] flex-1">
                  <label htmlFor="target_date" className="label">Target selesai</label>
                  <input id="target_date" name="target_date" type="date" required className="input" />
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="min-w-[280px] flex-[3_1_280px]">
                  <label htmlFor="preventive_action" className="label">Preventive action</label>
                  <textarea id="preventive_action" name="preventive_action" rows={3} required className="input" placeholder="Langkah agar masalah yang sama tidak terulang" />
                </div>
                <div className="min-w-[180px] flex-1">
                  <label htmlFor="effective_from" className="label">Berlaku mulai</label>
                  <input id="effective_from" name="effective_from" type="date" required className="input" />
                </div>
              </div>
              <div>
                <label htmlFor="files" className="label">Lampiran pendukung (opsional, maksimal 5)</label>
                <input id="files" name="files" type="file" multiple accept="image/*,video/mp4,application/pdf" className="block w-full text-sm" />
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="min-w-[200px] flex-1">
                  <label htmlFor="responder_name" className="label">Nama penanggung jawab</label>
                  <input id="responder_name" name="responder_name" required className="input" />
                </div>
                <div className="min-w-[200px] flex-1">
                  <label htmlFor="responder_position" className="label">Jabatan</label>
                  <input id="responder_position" name="responder_position" required className="input" />
                </div>
                <div className="min-w-[200px] flex-1">
                  <label htmlFor="responder_email" className="label">Email</label>
                  <input id="responder_email" name="responder_email" type="email" required className="input" />
                </div>
              </div>
              <label className="flex min-h-11 items-start gap-3">
                <input type="checkbox" name="confirm" className="mt-1 size-4" required />
                <span>Saya menyatakan respons ini mewakili {d.supplier_name} dan isinya benar.</span>
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-slate-600">Tanggal dan jam respons dicatat otomatis.</span>
                <Submit>Kirim respons</Submit>
              </div>
            </ActionForm>
          </section>
        ) : (
          <NcfPart2 d={d} fileHref={fileHref} />
        )}
        <p className="text-sm text-slate-600">Pertanyaan: hubungi Purchasing Integra Group. Halaman ini dibuka lewat link pribadi, tanpa akun.</p>
      </Shell>
    </>
  );
}

function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl justify-between px-4 py-3 sm:px-8">
        <span className="font-bold tracking-wide">INTEGRA GROUP</span>
        <span className="text-sm text-slate-600">Halaman respons supplier</span>
      </div>
    </header>
  );
}
