import type { Metadata } from "next";
import { headers } from "next/headers";
import { Facts, VerifyShell } from "@/components/verify-shell";
import { currentUser } from "@/lib/auth";
import { AppError, fmtDate } from "@/lib/util";
import { verifyDocument } from "@/lib/verify";

export const metadata: Metadata = { title: "Verifikasi NCF – Integra Group", robots: { index: false } };

// Document QR: anyone holding the paper can check it against the record. They see only what the paper shows.
export default async function VerifyDoc({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const viewer = await currentUser();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let v;
  try {
    v = await verifyDocument(code, viewer, ip);
  } catch (e) {
    if (e instanceof AppError) return <VerifyShell kind="Verifikasi dokumen" tone="bad" verdict={<b>QR ini tidak cocok dengan dokumen NCF mana pun.</b>} />;
    throw e;
  }
  const verdict = v.void
    ? <><b>NCF {v.ncf_no} sudah dibatalkan (void).</b> Dokumen ini tidak berlaku.</>
    : v.superseded
      ? <><b>Salinan ini sudah tidak berlaku.</b> NCF {v.ncf_no} diubah setelah salinan ini dicetak. Minta salinan terbaru ke Integra.</>
      : <><b>Dokumen asli.</b> NCF {v.ncf_no} sesuai dengan rekaman di sistem Integra Group.</>;
  return (
    <VerifyShell kind="Verifikasi dokumen" tone={v.void || v.superseded ? "bad" : "ok"} verdict={verdict}
      staffHref={v.canOpenFull ? `/ncf/${v.ncf_id}` : "/login"}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Non Conformity Form</div>
        <h1 className="font-mono text-[26px] font-semibold leading-tight">{v.ncf_no}</h1>
      </div>
      <Facts rows={[
        ["Nama Supplier", v.supplier],
        ["Business Unit", v.bu],
        ["No. SJ", v.sj_no],
        ["Tanggal Masuk", fmtDate(v.receipt_date)],
      ]} />
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Barang</h2>
        <ul className="divide-y divide-hairline rounded-sm border border-hairline">
          {v.items.map((i) => (
            <li key={i.item_code} className="px-3 py-2.5">
              <div className="text-[14px] font-medium">{i.item_name}</div>
              <div className="num text-[12px] text-muted">{i.item_code}</div>
              <div className="num mt-1 text-[12px] text-slate-700">Datang {i.qty_received} · Sample {i.qty_sample} · Cacat {i.qty_defect} · Retur {i.qty_return}</div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Tanda tangan</h2>
        <ul className="flex flex-col gap-2">
          {v.approvals.map((a) => (
            <li key={a.step_no} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
              <span><b className="font-semibold">{a.signer_name}</b> <span className="text-muted">· {a.signer_position}</span></span>
              <span className="num text-[12px] text-muted">{fmtDate(a.decided_at)}</span>
            </li>
          ))}
        </ul>
      </div>
    </VerifyShell>
  );
}
