import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { EvidenceList, ItemTable } from "@/components/ncf-document";
import { Banner, Field, Section, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { LIMITS } from "@/lib/files";
import { GOODS_STATUS } from "@/lib/labels";
import { getNcf, missingForSubmit, mrregLines, problemCategories } from "@/lib/ncf";
import { AppError, fmtDate } from "@/lib/util";
import {
  addEvidenceAction,
  addItemAction,
  removeEvidenceAction,
  removeItemAction,
  saveHeaderAction,
  submitAction,
} from "../../actions";

export default async function EditNcf({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let d;
  try {
    d = await getNcf(user, Number(id));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  if (d.status !== "DRAFT" || !hasRole(user, "QC_INSPECTOR", d.bu_id)) redirect(`/ncf/${d.id}`);
  const [lines, categories] = await Promise.all([mrregLines(d.id), problemCategories()]);
  const free = lines.filter((l) => !l.used);
  const missing = missingForSubmit(d);
  const ownFiles = d.evidence.filter((e) => e.capa_response_id === null);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm"><Link href={`/ncf/${d.id}`}>← View NCF</Link></p>
          <h1 className="mt-1 text-3xl font-bold">Non Conformity Form</h1>
          <p className="text-slate-600">Diisi QC Incoming saat pemeriksaan. Draft is saved per section.</p>
        </div>
        <span className="text-lg font-semibold">No. {d.ncf_no}</span>
      </div>

      <Section title="A. Identifikasi masalah" aside="No. Komplain and SAP fields are filled automatically">
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <Field label="No. Komplain">{d.ncf_no}</Field>
          <Field label="Business Unit">{d.bu_name}</Field>
          <Field label="Nama Supplier">{d.supplier_name}</Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-4">
          <Field label="No. SJ (dari MRReg)">{d.sj_no}</Field>
          <Field label="Tanggal SJ">{fmtDate(d.sj_date)}</Field>
          <Field label="Tanggal Masuk">{fmtDate(d.receipt_date)}</Field>
        </div>
      </Section>

      <Section title="B. Penyimpangan yang terjadi" aside="Nama, kode barang dan Jumlah Datang dari SAP">
        <ItemTable d={d}>
          {(itemId) => (
            <ActionForm action={removeItemAction}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="item_id" value={itemId} />
              <Submit className="h-10 px-2 text-sm font-semibold text-red-700 hover:underline">Remove</Submit>
            </ActionForm>
          )}
        </ItemTable>
        {free.length > 0 ? (
          <ActionForm action={addItemAction} resetOnOk className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-4">
            <input type="hidden" name="id" value={d.id} />
            <div className="min-w-[260px] flex-[3_1_260px]">
              <label htmlFor="line_id" className="label">Barang (dari MRReg)</label>
              <select id="line_id" name="line_id" className="input" required>
                {free.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.item_code} · {l.item_name} · datang {l.qty_received} {l.uom} · PO {l.po_no}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label htmlFor="qty_sample" className="label">Jml Sample</label>
              <input id="qty_sample" name="qty_sample" inputMode="decimal" required className="input text-right" />
            </div>
            <div className="w-28">
              <label htmlFor="qty_defect" className="label">Jml Cacat</label>
              <input id="qty_defect" name="qty_defect" inputMode="decimal" required className="input text-right" />
            </div>
            <div className="w-28">
              <label htmlFor="qty_return" className="label">Qty Retur</label>
              <input id="qty_return" name="qty_return" inputMode="decimal" defaultValue="0" className="input text-right" />
            </div>
            <Submit className="btn">+ Tambah barang</Submit>
          </ActionForm>
        ) : (
          <p className="mt-3 text-sm text-slate-600">All items of this MRReg are on the NCF.</p>
        )}
      </Section>

      <ActionForm action={saveHeaderAction} className="flex flex-col gap-5">
        <input type="hidden" name="id" value={d.id} />
        <Section title="Pemeriksaan dan status barang">
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="inspect_date" className="label">Tanggal Periksa</label>
              <input id="inspect_date" name="inspect_date" type="date" defaultValue={d.inspect_date} required className="input" />
            </div>
            <div className="min-w-[200px] flex-1">
              <label htmlFor="inspect_time" className="label">Jam Periksa</label>
              <input id="inspect_time" name="inspect_time" type="time" defaultValue={d.inspect_time} required className="input" />
            </div>
          </div>
          <fieldset className="mt-5">
            <legend className="label">C. Status barang</legend>
            <div className="flex flex-wrap gap-3">
              {Object.entries(GOODS_STATUS).map(([k, label]) => (
                <label key={k} className="flex min-h-11 flex-1 basis-56 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 px-4 py-3 has-[:checked]:border-2 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="radio" name="goods_status" value={k} defaultChecked={d.goods_status === k} className="mt-1 size-4" />
                  <span className="font-semibold">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4">
            <label htmlFor="hold_note" className="label">Keterangan konfirmasi (setelah 24 jam), only for Hold</label>
            <input id="hold_note" name="hold_note" defaultValue={d.hold_note ?? ""} className="input" />
          </div>
        </Section>
        <Section title="D. Masalah yang ditemukan">
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="problem_category_id" className="label">Kategori masalah</label>
              <select id="problem_category_id" name="problem_category_id" defaultValue={d.problem_category_id ?? ""} className="input">
                <option value="">Pilih kategori</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="min-w-[320px] flex-[3_1_320px]">
              <label htmlFor="problem_desc" className="label">Uraian masalah (10 to 2,000 characters)</label>
              <textarea id="problem_desc" name="problem_desc" rows={3} defaultValue={d.problem_desc ?? ""} className="input" />
            </div>
          </div>
        </Section>
        <Section title="F. Tindak lanjut dari Integra">
          <label htmlFor="follow_up" className="label">Tindak lanjut</label>
          <textarea id="follow_up" name="follow_up" rows={3} defaultValue={d.follow_up ?? ""} className="input" />
        </Section>
        <div className="flex justify-end">
          <Submit className="btn">Save sections C, D and F</Submit>
        </div>
      </ActionForm>

      <Section title="E. Bukti" aside={`Foto, video, dokumen · max ${LIMITS.filesPerNcf} files, video up to 50 MB`}>
        <EvidenceList items={ownFiles} fileHref={(f) => `/api/files/${f}`}>
          {(evId) => (
            <ActionForm action={removeEvidenceAction}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="evidence_id" value={evId} />
              <Submit className="h-10 px-2 text-sm font-semibold text-red-700 hover:underline">Remove</Submit>
            </ActionForm>
          )}
        </EvidenceList>
        <ActionForm action={addEvidenceAction} resetOnOk className="mt-4 flex flex-col gap-3 rounded-lg border-2 border-dashed border-slate-400 bg-slate-50 p-4">
          <input type="hidden" name="id" value={d.id} />
          <div>
            <label htmlFor="files" className="label">Files (or take a photo with the camera)</label>
            <input id="files" name="files" type="file" multiple accept="image/*,video/mp4,video/quicktime,application/pdf,.docx,.xlsx" className="block w-full text-sm" />
          </div>
          <div>
            <label htmlFor="note" className="label">Catatan bukti</label>
            <input id="note" name="note" className="input" />
          </div>
          <div><Submit className="btn">Upload</Submit></div>
        </ActionForm>
      </Section>

      <Section title="Sign and submit for approval">
        {missing.length > 0 ? (
          <Banner kind="info">
            Still missing: <ul className="mt-1 list-disc pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </Banner>
        ) : (
          <Banner kind="ok">Complete. Submitting locks the content, creates a numbered version and signs it with your name.</Banner>
        )}
        <ActionForm action={submitAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={d.id} />
          <div className="min-w-[240px]">
            <label htmlFor="password" className="label">Your password, to sign</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
          </div>
          <Submit>Sign and submit</Submit>
        </ActionForm>
      </Section>
    </Shell>
  );
}
