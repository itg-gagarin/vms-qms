import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Banner, Section, Shell } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { STATUS_LABEL, type NcfStatus } from "@/lib/labels";
import { AppError, fmtDate, fmtDateTime } from "@/lib/util";
import { verifyDocument } from "@/lib/verify";

export const metadata: Metadata = { title: "Verifikasi NCF – Integra Group", robots: { index: false } };

// Document QR (FD section 9): anyone holding the paper can compare it with the record.
// Evidence opens only after login as Auditor or an internal role.
export default async function VerifyDoc({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const viewer = await currentUser();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let v;
  try {
    v = await verifyDocument(code, viewer, ip);
  } catch (e) {
    if (e instanceof AppError) return <Shell><Banner kind="error">{e.message}</Banner></Shell>;
    throw e;
  }
  return (
    <Shell>
      <div>
        <p className="font-bold tracking-wide">INTEGRA GROUP · Verifikasi dokumen</p>
        <h1 className="mt-1 text-3xl font-bold">NCF {v.ncf_no}</h1>
      </div>
      {v.status === "VOID" && <Banner kind="error">VOID. This NCF was cancelled.</Banner>}
      {v.superseded ? (
        <Banner kind="error">This paper shows version {v.version_no}, which was replaced by a later version. Do not rely on it.</Banner>
      ) : (
        <Banner kind="ok">This is the current version ({v.version_no}) of the record in the VMS.</Banner>
      )}
      <Section title="Record">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {[
            ["Status", STATUS_LABEL[v.status as NcfStatus]],
            ["Supplier", v.supplier],
            ["Business Unit", v.bu],
            ["No. SJ", v.sj_no],
            ["Tanggal Masuk", fmtDate(v.receipt_date)],
            ["Version and content hash", `${v.version_no} · ${v.content_hash.slice(0, 16)}…`],
          ].map(([k, val]) => (
            <div key={k}><dt className="text-[13px] font-semibold text-slate-600">{k}</dt><dd>{val}</dd></div>
          ))}
        </dl>
      </Section>
      <Section title="Items">
        <ul className="flex flex-col gap-1">
          {v.items.map((i) => (
            <li key={i.item_code}>{i.item_code} · {i.item_name}: datang {i.qty_received}, sample {i.qty_sample}, cacat {i.qty_defect}, retur {i.qty_return}</li>
          ))}
        </ul>
      </Section>
      <Section title="Signatures">
        <ul className="flex flex-col gap-1">
          {v.approvals.map((a) => (
            <li key={a.step_no}>
              {a.signer_name}, {a.signer_position}: {a.decision === "APPROVED" ? `signed ${fmtDateTime(a.decided_at)}` : a.decision ?? "waiting"}
            </li>
          ))}
        </ul>
      </Section>
      {v.canOpenFull ? (
        <Link href={`/ncf/${v.ncf_id}`} className="btn btn-primary no-underline">Open full record with evidence</Link>
      ) : (
        <Banner kind="info">
          Photos, videos and documents open only for auditors and Integra staff. <Link href="/login">Sign in</Link> to see them.
        </Banner>
      )}
    </Shell>
  );
}
