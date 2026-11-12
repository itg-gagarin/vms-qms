import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { NcfPart1, NcfPart2 } from "@/components/ncf-document";
import { Banner, Section, Shell, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole } from "@/lib/core";
import { auditTrail, getNcf, missingForSubmit } from "@/lib/ncf";
import { AppError, fmtDateTime } from "@/lib/util";
import { closeAction, decideAction, supplierPanelAction } from "../actions";

const MESSAGES: Record<string, string> = {
  "approved-step": "Approved and signed. The next approver is notified.",
  "approved-final": "Approved and signed. The NCF is now with Purchasing to send.",
  returned: "Returned to QC with your comment.",
  rejected: "Rejected. The NCF is void.",
  closed: "NCF closed.",
};

export default async function NcfPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { msg } = await searchParams;
  let d;
  try {
    d = await getNcf(user, Number(id));
  } catch (e) {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const trail = await auditTrail(d.id);
  const pending = d.status === "WAITING_APPROVAL" ? d.approvals.find((a) => a.decision === null) : undefined;
  const purchasing = hasRole(user, ["PURCHASING", "PCH_DIV_HEAD"]);
  const qc = hasRole(user, "QC_INSPECTOR", d.bu_id);
  const fileHref = (f: number) => `/api/files/${f}`;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm"><Link href="/ncf">← NCF list</Link></p>
          <h1 className="mt-1 text-3xl font-bold">NCF {d.ncf_no}</h1>
          <p className="text-slate-600">
            {d.supplier_name} · {d.bu_name}
            {d.version && <> · Versi {d.version.version_no}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={d.status} />
          <Link href={`/print/${d.id}`} className="btn no-underline" target="_blank">Print form (A4)</Link>
        </div>
      </div>

      {msg && MESSAGES[msg] && <Banner kind="ok">{MESSAGES[msg]}</Banner>}
      {d.status === "VOID" && <Banner kind="error">Void: {d.void_reason}</Banner>}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_740px] flex-col gap-5">
          <NcfPart1 d={d} fileHref={fileHref} />
          {["SENT", "RESPONDED", "CLOSED"].includes(d.status) && <NcfPart2 d={d} fileHref={fileHref} />}
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5" aria-label="Actions and signatures">
          {d.status === "DRAFT" && qc && (
            <Section title="Draft">
              {d.history.some((h) => h.decision === "RETURNED") && (
                <div className="mb-3"><Banner kind="info">Returned: {d.history.filter((h) => h.decision === "RETURNED").at(-1)?.comment}</Banner></div>
              )}
              <p className="mb-3 text-sm text-slate-700">
                {missingForSubmit(d).length ? `${missingForSubmit(d).length} item(s) still missing before submit.` : "Complete. Ready to sign and submit."}
              </p>
              <Link href={`/ncf/${d.id}/edit`} className="btn btn-primary w-full no-underline">Edit and submit</Link>
            </Section>
          )}

          {pending && pending.approver_id === user.id && (
            <Section title="Your approval">
              <ActionForm action={decideAction} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={d.id} />
                <p className="text-sm text-slate-700">
                  Step {pending.step_no}: {pending.title}. Approving signs version {d.version?.version_no} electronically.
                </p>
                <div>
                  <label htmlFor="comment" className="label">Comment (required to return or reject)</label>
                  <textarea id="comment" name="comment" rows={2} className="input" />
                </div>
                <div>
                  <label htmlFor="pw" className="label">Your password, to sign</label>
                  <input id="pw" name="password" type="password" required autoComplete="current-password" className="input" />
                </div>
                <p className="text-xs text-slate-600">
                  Saya menyetujui isi NCF ini. Persetujuan ini tercatat dengan nama, jabatan, tanggal dan jam.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Submit name="decision" value="APPROVED">Setujui</Submit>
                  <Submit name="decision" value="RETURNED" className="btn">Kembalikan</Submit>
                  <Submit name="decision" value="REJECTED" className="btn btn-danger">Tolak</Submit>
                </div>
              </ActionForm>
            </Section>
          )}

          {purchasing && ["APPROVED", "SENT", "RESPONDED", "CLOSED"].includes(d.status) && (
            <Section title={d.status === "APPROVED" ? "Send to supplier" : "Supplier"}>
              <ActionForm action={supplierPanelAction} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={d.id} />
                {d.status === "APPROVED" ? (
                  <>
                    <p className="text-sm text-slate-700">
                      Email sends Page 1 and the response link to the supplier&apos;s NCF contacts. Generate link if you share it
                      by WhatsApp or another channel. The response time starts now.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Submit name="method" value="EMAIL">Send by email</Submit>
                      <Submit name="method" value="LINK" className="btn">Generate link</Submit>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-700">
                      Sent {fmtDateTime(d.request?.sent_at)} by {d.request?.sent_by_name} ({d.request?.send_method === "LINK" ? "link" : "email"}).{" "}
                      {d.request?.first_opened_at ? `Opened ${fmtDateTime(d.request.first_opened_at)}.` : "Not opened yet."}
                    </p>
                    {d.status === "SENT" && (
                      <>
                        <input type="hidden" name="op" value="reissue" />
                        <Submit className="btn w-full">New link (old links stop working)</Submit>
                      </>
                    )}
                  </>
                )}
              </ActionForm>
            </Section>
          )}

          {d.status === "RESPONDED" && purchasing && (
            <Section title="Verify and close">
              <ActionForm action={closeAction} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={d.id} />
                <div>
                  <label htmlFor="note" className="label">Hasil verifikasi atas respons supplier</label>
                  <textarea id="note" name="note" rows={3} required className="input" />
                </div>
                <Submit>Close NCF</Submit>
              </ActionForm>
            </Section>
          )}

          <Section title="Signatures" aside={d.version ? `Versi ${d.version.version_no}` : undefined}>
            {d.approvals.length === 0 ? (
              <p className="text-sm text-slate-600">Signatures start when QC submits.</p>
            ) : (
              <ol className="flex flex-col">
                {d.approvals.map((a) => (
                  <li key={a.id} className="border-t border-slate-200 py-2 first:border-t-0">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold">{a.title}</span>
                      <span className={`text-sm ${a.decision === "APPROVED" ? "text-emerald-800" : a.decision ? "text-red-800" : "text-slate-600"}`}>
                        {a.decision === "APPROVED" ? "Signed" : a.decision === "RETURNED" ? "Returned" : a.decision === "REJECTED" ? "Rejected" : "Waiting"}
                      </span>
                    </div>
                    <div className="text-sm text-slate-700">
                      {a.signer_name}{a.decided_at && ` · ${fmtDateTime(a.decided_at)}`}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Audit trail" aside={`${trail.length} events`}>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-brand">Show events</summary>
              <ol className="mt-2 flex flex-col text-sm">
                {trail.map((t, i) => (
                  <li key={i} className="border-t border-slate-200 py-1.5">
                    <span className="font-semibold">{t.action}</span> · {fmtDateTime(t.at)} · {t.actor_name ?? t.actor_type.toLowerCase()}
                    {t.new_value && <div className="text-slate-600">{t.new_value}</div>}
                  </li>
                ))}
              </ol>
            </details>
          </Section>
        </aside>
      </div>
    </Shell>
  );
}
