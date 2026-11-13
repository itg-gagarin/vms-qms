import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Facts, VerifyShell } from "@/components/verify-shell";
import { currentUser } from "@/lib/auth";
import { AppError, fmtDateTime } from "@/lib/util";
import { verifySignature } from "@/lib/verify";

export const metadata: Metadata = { title: "Verifikasi tanda tangan – Integra Group", robots: { index: false } };

// Signature QR: who signed which NCF, and when. Nothing about how the system signs.
export default async function VerifySig({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const viewer = await currentUser();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let a;
  try {
    a = await verifySignature(code, viewer, ip);
  } catch (e) {
    if (e instanceof AppError) return <VerifyShell kind="Verifikasi tanda tangan" tone="bad" verdict={<b>QR ini tidak cocok dengan tanda tangan mana pun.</b>} />;
    throw e;
  }
  const verdict = a.superseded
    ? <><b>Tanda tangan ini sudah tidak berlaku.</b> NCF {a.ncf_no} diubah setelah ditandatangani, jadi tanda tangan ini tidak mencakup isi terbaru.</>
    : <><b>Tanda tangan elektronik asli</b> pada NCF {a.ncf_no}.</>;
  return (
    <VerifyShell kind="Verifikasi tanda tangan" tone={a.superseded ? "bad" : "ok"} verdict={verdict}>
      <div>
        <h1 className="text-[24px] font-semibold leading-tight">{a.signer_name}</h1>
        <p className="text-muted">{a.signer_position}</p>
      </div>
      <Facts rows={[
        ["Dokumen", <span key="d" className="num">NCF {a.ncf_no}</span>],
        ["Peran", a.step_no === 0 ? "Pembuat (QC Incoming)" : "Menyetujui"],
        ["Tanggal dan jam", <span key="t" className="num">{fmtDateTime(a.decided_at)}</span>],
      ]} />
      <p className="text-[13px]"><Link href={`/v/${a.verify_code}`}>Periksa dokumen NCF ini</Link></p>
    </VerifyShell>
  );
}
