import { Clock, FileDown, Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { AuditTimeline } from "@/components/audit-timeline";
import { EvidenceList, NcfPart1, NcfPart2 } from "@/components/ncf-document";
import { PhoneActionBar } from "@/components/phone-action-bar";
import { StageStepper } from "@/components/stage-stepper";
import { Avatar, Banner, Section, Shell, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole, workingDaysBetween } from "@/lib/core";
import { pool } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/labels";
import { auditTrail, getNcf, type NcfDetail } from "@/lib/ncf";
import { nowWibLocal } from "@/lib/purchasing";
import { AppError, fmtDate, fmtDateTime } from "@/lib/util";
import { closeAction, decideAction, markReturnedAction, markSentAction } from "../actions";

const MESSAGES: Record<string, string> = {
  "approved-step": "Approved and signed. The next approver is notified.",
  "approved-final": "Approved and signed. The NCF is now with Purchasing to send.",
  returned: "Returned to QC with your comment.",
  rejected: "Rejected. The NCF is void.",
  closed: "NCF closed.",
  sent: "Marked as sent. The supplier's response clock is running.",
  "returned-reply": "Supplier's reply recorded and the clock stopped. Verify it and close the NCF.",
};

type Role = "qc" | "approver" | "purchasing" | null;

export default async function NcfPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { msg } = await searchParams;
  // The trail starts loading with the NCF; it is only shown once getNcf has checked the viewer may read it.
  const trailP = auditTrail(Number(id));
  trailP.catch(() => {});
  let d: NcfDetail;
  try {
    d = await getNcf(user, Number(id));
  } catch (e) {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const trail = await trailP;
  const pending = d.status === "WAITING_APPROVAL" ? d.approvals.find((a) => a.decision === null) : undefined;
  const purchasing = hasRole(user, ["PURCHASING", "PCH_DIV_HEAD"]);
  const qc = hasRole(user, "QC_INSPECTOR", d.bu_id);
  const runningDays = d.status === "SENT" && d.request?.sent_at ? await workingDaysBetween(pool, d.request.sent_at, new Date()) : null;
  const fileHref = (f: number) => `/api/files/${f}`;

  // Who acts now, and whether that is the person looking at the page.
  const actor: Role =
    d.status === "DRAFT" && qc ? "qc"
      : pending && pending.approver_id === user.id ? "approver"
      : ["APPROVED", "SENT", "RESPONDED"].includes(d.status) && purchasing ? "purchasing"
      : null;
  // The one green (advance) action on the screen.
  const primary =
    actor === "qc" ? { href: `/ncf/${d.id}/edit`, label: "Edit and submit" }
      : actor === "approver" ? { href: "#action", label: `Approve as ${pending!.title}` }
      : actor === "purchasing" ? { href: "#action", label: d.status === "APPROVED" ? "Mark as sent" : d.status === "SENT" ? "Mark returned" : "Verify and close" }
      : null;

  return (
    <Shell>
      <section className="card overflow-hidden p-0" aria-label="NCF summary">
        <div className="flex flex-col gap-4 px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
            <Link href="/ncf" className="text-muted no-underline hover:text-ink">NCF Management</Link>
            <span aria-hidden="true" className="text-slate-300">/</span>
            <Link href={`/ncf?status=${d.status}`} className="text-muted no-underline hover:text-ink">{STATUS_LABEL[d.status]}</Link>
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-mono text-[24px] font-semibold leading-tight tracking-tight">NCF {d.ncf_no}</h1>
                <StatusBadge status={d.status} />
              </div>
              <p className="mt-1 text-[14px] text-muted">
                <span className="font-semibold text-ink">{d.supplier_name}</span> <span className="num text-[12px]">{d.supplier_code}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/print/${d.id}`} className="btn" target="_blank"><Printer size={16} aria-hidden="true" /> Print form</Link>
              {/* A jump to the action panel; when the panel is on this page, its button is the one green action. */}
              {primary && <Link href={primary.href} className={`max-md:hidden ${actor === "qc" ? "btn btn-advance" : "btn"}`}>{primary.label}</Link>}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-hairline pt-4 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ["No. MRReg", d.mrreg_no ?? "–", true],
              ["No. PO", d.po_no ?? "–", true],
              ["Business Unit", d.bu_name, false],
              ["Tanggal Masuk", fmtDate(d.receipt_date), true],
              ["Dibuat oleh", `${d.created_by_name}`, false],
              ["Dibuat", fmtDate(d.created_at), true],
            ] as [string, string, boolean][]).map(([k, v, mono]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{k}</dt>
                <dd className={`mt-0.5 truncate text-[14px] text-ink ${mono ? "num" : ""}`} title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <StatusStrip d={d} pending={pending} runningDays={runningDays} />
        </div>
        <div className="border-t border-hairline bg-slate-50/60 px-3 pb-4 pt-5 sm:px-5">
          <StageStepper d={d} />
        </div>
      </section>

      {msg && MESSAGES[msg] && <Banner kind="ok">{MESSAGES[msg]}</Banner>}

      {actor && actor !== "qc" && (
        <div id="action" className="scroll-mt-20">
          {actor === "approver" && pending && <ApprovalPanel d={d} pending={pending} />}
          {actor === "purchasing" && d.status === "APPROVED" && <SendPanel d={d} />}
          {actor === "purchasing" && d.status === "SENT" && <ReturnPanel d={d} runningDays={runningDays} />}
          {actor === "purchasing" && d.status === "RESPONDED" && <ClosePanel d={d} fileHref={fileHref} />}
        </div>
      )}

      {/* From 1280px wide the signatures and audit trail sit on the right; below that they follow the document. */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <NcfPart1 d={d} fileHref={fileHref} />
          {["SENT", "RESPONDED", "CLOSED"].includes(d.status) && <NcfPart2 d={d} fileHref={fileHref} />}
        </div>

        <aside className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-4" aria-label="Signatures and audit trail">
          <Section title="Signatures" aside={d.version && d.version.version_no > 1 ? `Versi ${d.version.version_no}` : undefined}>
            {d.approvals.length === 0 ? (
              <p className="text-muted">Signatures start when QC submits.</p>
            ) : (
              <ol className="flex flex-col">
                {d.approvals.map((a) => (
                  <li key={a.id} className="flex gap-3 border-t border-hairline py-2.5 first:border-t-0 first:pt-0 last:pb-0">
                    <Avatar name={a.signer_name} size={30} />
                    <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold">{a.title}</span>
                      <span className={`text-[13px] font-medium ${a.decision === "APPROVED" ? "text-status-emerald" : a.decision ? "text-status-red" : "text-muted"}`}>
                        {a.decision === "APPROVED" ? "Signed" : a.decision === "RETURNED" ? "Returned" : a.decision === "REJECTED" ? "Rejected"
                          : d.status !== "WAITING_APPROVAL" ? "Not reached" : a.id === pending?.id ? "Waiting" : "Queued"}
                      </span>
                    </div>
                    <div className="text-[13px] text-slate-700">
                      {a.signer_name}{a.decided_at && <> · <span className="font-mono text-[12px]">{fmtDateTime(a.decided_at)}</span></>}
                    </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Audit trail" aside={`${trail.length} events`}>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <AuditTimeline events={trail} />
            </div>
          </Section>
        </aside>
      </div>
      {primary && <PhoneActionBar href={primary.href} label={primary.label} />}
    </Shell>
  );
}

/** One line under the title: where the NCF stands, in words. */
function StatusStrip({ d, pending, runningDays }: { d: NcfDetail; pending?: NcfDetail["approvals"][number]; runningDays: number | null }) {
  const chain = d.approvals.filter((a) => a.step_no > 0);
  const lastReturn = d.history.filter((h) => h.decision === "RETURNED").at(-1);
  const [title, rest, tone] = ((): [string, string, "slate" | "amber" | "red" | "emerald"] => {
    switch (d.status) {
      case "DRAFT":
        return lastReturn ? ["Returned to QC", `${lastReturn.signer_name}: ${lastReturn.comment}`, "amber"] : ["Draft", "QC is filling it in", "slate"];
      case "WAITING_APPROVAL":
        return ["Pending approval", `step ${pending?.step_no} of ${chain.length}, waiting for ${pending?.signer_name} (${pending?.title})`, "amber"];
      case "APPROVED":
        return ["Approved", "waiting for Purchasing to send the form to the supplier", "slate"];
      case "SENT":
        return ["Sent to supplier", `${fmtDateTime(d.request?.sent_at)} · ${runningDays} working day${runningDays === 1 ? "" : "s"} so far, no reply yet`, "amber"];
      case "RESPONDED":
        return ["Supplier replied", `${fmtDateTime(d.request?.responded_at)} after ${d.request?.response_working_days} working days · to verify`, "slate"];
      case "CLOSED":
        return ["Closed", `${fmtDate(d.closed_at)} by ${d.closed_by_name} · supplier replied in ${d.request?.response_working_days} working days`, "emerald"];
      case "VOID":
        return ["Void", d.void_reason ?? "", "red"];
    }
  })();
  const color = {
    slate: "border-hairline text-slate-700", amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800", emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-sm border px-3 py-2 ${color}`}>
      <Clock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p><span className="font-semibold">{title}</span>{rest && <> · {rest}</>}</p>
    </div>
  );
}

function ApprovalPanel({ d, pending }: { d: NcfDetail; pending: NcfDetail["approvals"][number] }) {
  return (
    <Section title="Your approval" aside={`Step ${pending.step_no}: ${pending.title}`}>
      <ActionForm action={decideAction} className="grid gap-3 md:grid-cols-[1fr_280px]">
        <input type="hidden" name="id" value={d.id} />
        <div>
          <label htmlFor="comment" className="label">Comment (required to return or reject)</label>
          <textarea id="comment" name="comment" rows={3} className="input" />
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <label htmlFor="pw" className="label">Your password, to sign</label>
            <input id="pw" name="password" type="password" required autoComplete="current-password" className="input" />
          </div>
          <p className="text-[12px] text-muted">
            Saya menyetujui isi NCF ini (versi {d.version?.version_no}). Persetujuan ini tercatat dengan nama, jabatan, tanggal dan jam.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Submit name="decision" value="APPROVED" className="btn btn-advance">Setujui</Submit>
          <Submit name="decision" value="RETURNED" className="btn">Kembalikan</Submit>
          <Submit name="decision" value="REJECTED" className="btn btn-danger">Tolak</Submit>
        </div>
      </ActionForm>
    </Section>
  );
}

/** No link leaves Integra: Purchasing exports the form, emails it from their own mailbox, and records when. */
function SendPanel({ d }: { d: NcfDetail }) {
  return (
    <Section title="Send to supplier">
      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-slate-700">
          <li>
            Export the form as PDF{" "}
            <Link href={`/print/${d.id}?export=1`} target="_blank" className="btn ml-1 h-8 px-3"><FileDown size={15} aria-hidden="true" /> Export form (PDF)</Link>
          </li>
          <li>Email the PDF to the supplier from your own mailbox. Contacts are in the Supplier Outbox. The supplier fills in Part 2 and emails it back.</li>
          <li>Record when it was sent. <span className="font-semibold">The supplier&apos;s response clock starts then.</span></li>
        </ol>
        <ActionForm action={markSentAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={d.id} />
          <div>
            <label htmlFor="sent_at" className="label">Sent at (WIB)</label>
            <input id="sent_at" name="sent_at" type="datetime-local" required defaultValue={nowWibLocal()} className="input" />
          </div>
          <div><Submit className="btn btn-advance">Mark as sent</Submit></div>
        </ActionForm>
      </div>
    </Section>
  );
}

function ReturnPanel({ d, runningDays }: { d: NcfDetail; runningDays: number | null }) {
  return (
    <Section title="Supplier reply" aside={<>Sent <span className="font-mono">{fmtDateTime(d.request?.sent_at)}</span> · {runningDays} wd so far</>}>
      <ActionForm action={markReturnedAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={d.id} />
        <p className="text-slate-700">
          When the supplier&apos;s reply arrives by email, attach it (the email saved as PDF or .eml, or the filled-in form) and mark it
          returned. The clock stops at the time you enter. The system keeps the reply as received; it does not re-type the CAPA.
        </p>
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <div>
            <label htmlFor="received_at" className="label">Received at (WIB)</label>
            <input id="received_at" name="received_at" type="datetime-local" required defaultValue={nowWibLocal()} className="input" />
          </div>
          <div>
            <label htmlFor="files" className="label">Supplier&apos;s reply</label>
            <input id="files" name="files" type="file" multiple required className="input h-auto py-1.5" accept=".pdf,.eml,.msg,.txt,.docx,.xlsx,image/*" />
          </div>
        </div>
        <div>
          <label htmlFor="note" className="label">Note (optional)</label>
          <input id="note" name="note" className="input" placeholder="e.g. replied by Hendra to purchasing@" />
        </div>
        <div><Submit className="btn btn-advance">Mark returned</Submit></div>
      </ActionForm>
    </Section>
  );
}

function ClosePanel({ d, fileHref }: { d: NcfDetail; fileHref: (f: number) => string }) {
  const reply = d.evidence.filter((e) => e.capa_response_id !== null);
  return (
    <Section title="Verify and close" aside={<>Reply received <span className="font-mono">{fmtDateTime(d.request?.responded_at)}</span></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">Supplier&apos;s reply</div>
          {reply.length ? <EvidenceList items={reply} fileHref={fileHref} /> : <p className="text-muted">No file.</p>}
        </div>
        <ActionForm action={closeAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={d.id} />
          <p className="text-[13px] text-muted">Close once you have checked the supplier&apos;s reply. The NCF then becomes read-only.</p>
          <div><Submit className="btn btn-advance">Close NCF</Submit></div>
        </ActionForm>
      </div>
    </Section>
  );
}
