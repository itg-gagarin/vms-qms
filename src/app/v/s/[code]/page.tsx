import type { Metadata } from "next";
import { headers } from "next/headers";
import { Banner, Section, Shell } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { AppError, fmtDateTime } from "@/lib/util";
import { verifySignature } from "@/lib/verify";

export const metadata: Metadata = { title: "Verifikasi tanda tangan – Integra Group", robots: { index: false } };

export default async function VerifySig({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const viewer = await currentUser();
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let a;
  try {
    a = await verifySignature(code, viewer, ip);
  } catch (e) {
    if (e instanceof AppError) return <Shell><Banner kind="error">{e.message}</Banner></Shell>;
    throw e;
  }
  return (
    <Shell>
      <div>
        <p className="font-bold tracking-wide">INTEGRA GROUP · Verifikasi tanda tangan elektronik</p>
        <h1 className="mt-1 text-[30px] font-bold">{a.signer_name}</h1>
        <p className="text-slate-700">{a.signer_position}</p>
      </div>
      {a.superseded && <Banner kind="error">This signature belongs to version {a.version_no}, which was replaced. It does not cover the current content.</Banner>}
      <Section title="Approval record">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {[
            ["Document", `NCF ${a.ncf_no}, version ${a.version_no}`],
            ["Decision", a.step_no === 0 ? "Signed as creator (QC Incoming)" : "Approved"],
            ["Date and time", fmtDateTime(a.decided_at)],
            ["Method", a.auth_method === "PASSWORD" ? "Personal login, password re-entered at signing" : a.auth_method],
            ["Content hash signed", `${a.content_hash.slice(0, 24)}…`],
          ].map(([k, v]) => (
            <div key={k}><dt className="text-[13px] font-semibold text-muted">{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </Section>
      <p className="text-sm text-muted">
        Document QR: <a href={`/v/${a.verify_code}`}>check the full NCF version</a>
      </p>
    </Shell>
  );
}
