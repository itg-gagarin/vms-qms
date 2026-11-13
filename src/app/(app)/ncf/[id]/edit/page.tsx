import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { EvidenceList, ItemTable } from "@/components/ncf-document";
import { PhoneActionBar } from "@/components/phone-action-bar";
import { ScrollToFlag } from "@/components/scroll-to-flag";
import { Banner, Field, FieldGrid, PageHead, Section, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { LIMITS } from "@/lib/files";
import { GOODS_STATUS } from "@/lib/labels";
import { getNcf, missingParts, mrregLines, type DraftPart, mrregPos, problemCategories } from "@/lib/ncf";
import { AppError, fmtDate } from "@/lib/util";
import {
  addEvidenceAction,
  addItemAction,
  removeEvidenceAction,
  removeItemAction,
  saveHeaderAction,
  setPoAction,
  submitAction,
} from "../../actions";

export default async function EditNcf({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ check?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // The pick lists load alongside the NCF; they are only used once getNcf has checked access.
  const listsP = Promise.all([mrregLines(Number(id)), problemCategories(), mrregPos(Number(id))]);
  listsP.catch(() => {});
  let d;
  try {
    d = await getNcf(user, Number(id));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  if (d.status !== "DRAFT" || !hasRole(user, "QC_INSPECTOR", d.bu_id)) redirect(`/ncf/${d.id}`);
  const [lines, categories, pos] = await listsP;
  const free = lines.filter((l) => !l.used);
  const missing = missingParts(d);
  const flag = (await searchParams).check === "1" && missing.length > 0;
  const mark = (part: DraftPart) => ({ id: `part-${part}`, flag, missing: missing.filter((m) => m.part === part).map((m) => m.text) });
  const ownFiles = d.evidence.filter((e) => e.capa_response_id === null);

  return (
    <Shell>
      {flag && <ScrollToFlag />}
      <PageHead title={<>Non Conformity Form <span className="num ml-1 text-[18px] font-medium text-muted">No. {d.ncf_no}</span></>}
        crumbs={[{ label: "NCF Management", href: "/ncf" }, { label: `NCF ${d.ncf_no}`, href: `/ncf/${d.id}` }, { label: "Edit draft" }]}
        sub="Diisi QC Incoming saat pemeriksaan. Each section saves on its own; submitting signs the whole form.">
        <Link href={`/ncf/${d.id}`} className="btn">View NCF</Link>
      </PageHead>

      <Section {...mark("A")} title="A. Identifikasi masalah" aside="No. Komplain and SAP fields are filled automatically">
        <FieldGrid cols={4}>
          <Field label="No. Komplain"><span className="num">{d.ncf_no}</span></Field>
          <Field label="Business Unit">{d.bu_name}</Field>
          <Field label="Nama Supplier">{d.supplier_name}</Field>
          <Field label="Kode Vendor"><span className="num">{d.supplier_code}</span></Field>
          <Field label="No. MRReg"><span className="num">{d.mrreg_no}</span></Field>
          <Field label="No. SJ (dari MRReg)"><span className="num">{d.sj_no}</span></Field>
          <Field label="Tanggal SJ"><span className="num">{fmtDate(d.sj_date)}</span></Field>
          <Field label="Tanggal Masuk"><span className="num">{fmtDate(d.receipt_date)}</span></Field>
        </FieldGrid>
        <ActionForm action={setPoAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-hairline pt-4">
          <input type="hidden" name="id" value={d.id} />
          <div className="min-w-[260px]">
            <label htmlFor="po_id" className="label">No. PO {pos.length > 1 && `(${pos.length} POs on this MRReg)`}</label>
            <select id="po_id" name="po_id" required defaultValue={d.po_id ?? ""} className="input">
              <option value="" disabled>Choose the PO…</option>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.po_no} · {p.lines} line{p.lines === 1 ? "" : "s"}</option>)}
            </select>
          </div>
          <Submit className="btn btn-commit">{d.po_id ? "Change PO" : "Set PO"}</Submit>
          <p className="w-full text-xs text-slate-500">
            One MRReg can hold several POs of the same supplier. The items in section B come from this PO.
            {d.items.length > 0 && " To change it, remove the items first."}
          </p>
        </ActionForm>
      </Section>

      <Section {...mark("B")} title="B. Penyimpangan yang terjadi" aside="Nama, kode barang dan Jumlah Datang dari SAP">
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
          <ActionForm action={addItemAction} resetOnOk className="mt-4 flex flex-wrap items-end gap-3 rounded-sm border border-hairline p-3">
            <input type="hidden" name="id" value={d.id} />
            <div className="min-w-[260px] flex-[3_1_260px]">
              <label htmlFor="line_id" className="label">Barang (dari MRReg)</label>
              <select id="line_id" name="line_id" className="input" required>
                {free.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.item_code} · {l.item_name}{l.item_group ? ` · ${l.item_group}` : ""} · datang {l.qty_received} {l.uom === "-" ? "" : l.uom}
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
            <Submit className="btn btn-commit">+ Tambah barang</Submit>
          </ActionForm>
        ) : (
          <p className="mt-3 text-sm text-muted">
            {d.po_id ? `All items of PO ${d.po_no} are on the NCF.` : "Choose the PO in section A to list its items."}
          </p>
        )}
      </Section>

      <ActionForm action={saveHeaderAction} className="flex flex-col gap-5">
        <input type="hidden" name="id" value={d.id} />
        <Section {...mark("C")} title="C. Pemeriksaan dan status barang">
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
            <legend className="label">Status barang</legend>
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
        <Section {...mark("D")} title="D. Masalah yang ditemukan">
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
        <Section {...mark("F")} title="F. Tindak lanjut dari Integra">
          <label htmlFor="follow_up" className="label">Tindak lanjut</label>
          <textarea id="follow_up" name="follow_up" rows={3} defaultValue={d.follow_up ?? ""} className="input" />
        </Section>
        <div className="flex justify-end">
          <Submit className="btn btn-commit">Save sections C, D and F</Submit>
        </div>
      </ActionForm>

      <Section {...mark("E")} title="E. Bukti" aside={`Foto, video, dokumen · max ${LIMITS.filesPerNcf} files, video up to 50 MB`}>
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
          <div><Submit className="btn btn-commit">Upload</Submit></div>
        </ActionForm>
      </Section>

      <Section id="submit" title="Sign and submit for approval">
        {missing.length > 0 ? (
          <Banner kind={flag ? "error" : "info"}>
            Still missing:
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => <li key={m.text}><a href={`#part-${m.part}`}>{m.part}</a> · {m.text}</li>)}
            </ul>
          </Banner>
        ) : (
          <Banner kind="ok">Complete. Submitting locks the content, creates a numbered version and signs it with your name.</Banner>
        )}
        <ActionForm action={submitAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={d.id} />
          <div className="min-w-[240px]">
            <label htmlFor="password" className="label">Your password, to sign</label>
            <input id="password" name="password" type="password" required={missing.length === 0} autoComplete="current-password" className="input" />
          </div>
          <Submit className="btn btn-advance">Sign and submit</Submit>
        </ActionForm>
      </Section>
      <PhoneActionBar href="#submit" label={missing.length ? `Sign and submit · ${missing.length} to complete` : "Sign and submit"} />
    </Shell>
  );
}
