import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm, Submit } from "@/components/action-form";
import { AuditTimeline } from "@/components/audit-timeline";
import { NcfPart1, NcfPart2 } from "@/components/ncf-document";
import { StageStepper } from "@/components/stage-stepper";
import { Banner, Section, Shell, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { hasRole, workingDaysBetween } from "@/lib/core";
import { pool } from "@/lib/db";
import { extractionConfigured } from "@/lib/extract";
import { auditTrail, getNcf, missingForSubmit, type NcfDetail } from "@/lib/ncf";
import { CAPA_LABELS, nowWibLocal } from "@/lib/purchasing";
import { AppError, fmtDate, fmtDateTime } from "@/lib/util";
import { closeAction, decideAction, markReturnedAction, reviewCapaAction, supplierPanelAction } from "../actions";

const MESSAGES: Record<string, string> = {
  "approved-step": "Approved and signed. The next approver is notified.",
  "approved-final": "Approved and signed. The NCF is now with Purchasing to send.",
  returned: "Returned to QC with your comment.",
  rejected: "Rejected. The NCF is void.",
  closed: "NCF closed.",
  "returned-read": "Reply recorded and the clock stopped. The CAPA was read from the reply: check it below before closing.",
  "returned-manual": "Reply recorded and the clock stopped. Type the CAPA in from the reply below.",
  "capa-confirmed": "CAPA confirmed. You can verify and close the NCF.",
};

type Role = "qc" | "approver" | "purchasing" | null;

export default async function NcfPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { msg } = await searchParams;
  let d: NcfDetail;
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
  const runningDays = d.status === "SENT" && d.request?.sent_at ? await workingDaysBetween(pool, d.request.sent_at, new Date()) : null;
  const capaToCheck = d.status === "RESPONDED" && d.capa?.received_via === "PURCHASING" && !d.capa.reviewed_at;
  const fileHref = (f: number) => `/api/files/${f}`;

  // Who acts now, and whether that is the person looking at the page.
  const actor: Role =
    d.status === "DRAFT" && qc ? "qc"
      : pending && pending.approver_id === user.id ? "approver"
      : ["APPROVED", "SENT", "RESPONDED"].includes(d.status) && purchasing ? "purchasing"
      : null;
  const primary =
    actor === "qc" ? { href: `/ncf/${d.id}/edit`, label: "Edit and submit" }
      : actor === "approver" ? { href: "#action", label: `Approve as ${pending!.title}` }
      : actor === "purchasing" ? {
        href: "#action",
        label: d.status === "APPROVED" ? "Generate link" : d.status === "SENT" ? "Mark returned" : capaToCheck ? "Check CAPA" : "Verify and close",
      }
      : null;

  return (
    <Shell>
      <p className="-mb-2 text-sm"><Link href="/ncf">← NCF list</Link></p>

      {/* Header card: the record, its status and what to do, on top */}
      <section className="card flex flex-col gap-4 p-5" aria-label="NCF summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-[28px] font-bold leading-tight tracking-tight">NCF {d.ncf_no}</h1>
              {d.po_no && <Chip>PO {d.po_no}</Chip>}
              {d.version && <Chip>Versi {d.version.version_no}</Chip>}
              <StatusBadge status={d.status} />
            </div>
            <p className="mt-1 text-[15px] text-slate-600">
              <span className="font-semibold text-slate-800">{d.supplier_name}</span> · {d.bu_name}
              {d.mrreg_no && <> · {d.mrreg_no}</>} · created by {d.created_by_name} on {fmtDate(d.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/print/${d.id}`} className="btn h-10 no-underline" target="_blank">
              <PrintIcon /> Print form
            </Link>
            {primary && <Link href={primary.href} className="btn btn-primary h-10 no-underline">{primary.label}</Link>}
          </div>
        </div>

        <StatusStrip d={d} pending={pending} runningDays={runningDays} capaToCheck={capaToCheck} />

        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-2 pb-3 pt-4">
          <StageStepper d={d} />
        </div>

        <NextStep d={d} pending={pending} actor={actor} capaToCheck={capaToCheck} />
      </section>

      {msg && MESSAGES[msg] && <Banner kind="ok">{MESSAGES[msg]}</Banner>}

      {/* The action for the person looking, right under the header */}
      {actor && actor !== "qc" && (
        <div id="action" className="scroll-mt-4">
          {actor === "approver" && pending && <ApprovalPanel d={d} pending={pending} />}
          {actor === "purchasing" && (d.status === "APPROVED" || d.status === "SENT") && <SupplierPanel d={d} runningDays={runningDays} />}
          {actor === "purchasing" && d.status === "RESPONDED" && (capaToCheck ? <CapaCheckPanel d={d} /> : <ClosePanel d={d} />)}
        </div>
      )}

      {/* From 1280px wide the signatures and audit trail sit on the right; below that they follow the document. */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          <NcfPart1 d={d} fileHref={fileHref} />
          {["SENT", "RESPONDED", "CLOSED"].includes(d.status) && <NcfPart2 d={d} fileHref={fileHref} />}
        </div>

        <aside className="flex min-w-0 flex-col gap-5 xl:sticky xl:top-4" aria-label="Signatures and audit trail">
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
                        {a.decision === "APPROVED" ? "Signed" : a.decision === "RETURNED" ? "Returned" : a.decision === "REJECTED" ? "Rejected"
                          : d.status !== "WAITING_APPROVAL" ? "Not reached" : a.id === pending?.id ? "Waiting" : "Queued"}
                      </span>
                    </div>
                    <div className="text-sm text-slate-700">{a.signer_name}{a.decided_at && ` · ${fmtDateTime(a.decided_at)}`}</div>
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
    </Shell>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[12px] font-medium text-slate-700">{children}</span>;
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z" />
    </svg>
  );
}

/** One line under the title: where the NCF stands, in words. */
function StatusStrip({ d, pending, runningDays, capaToCheck }: {
  d: NcfDetail; pending?: NcfDetail["approvals"][number]; runningDays: number | null; capaToCheck: boolean;
}) {
  const chain = d.approvals.filter((a) => a.step_no > 0);
  const lastReturn = d.history.filter((h) => h.decision === "RETURNED").at(-1);
  const [title, rest, tone] = ((): [string, string, "slate" | "amber" | "red" | "emerald"] => {
    switch (d.status) {
      case "DRAFT":
        return lastReturn ? ["Returned to QC", `${lastReturn.signer_name}: ${lastReturn.comment}`, "amber"] : ["Draft", "QC is filling it in", "slate"];
      case "WAITING_APPROVAL":
        return ["Pending approval", `step ${pending?.step_no} of ${chain.length}, waiting for ${pending?.signer_name} (${pending?.title})`, "slate"];
      case "APPROVED":
        return ["Approved", "waiting for Purchasing to generate the link and send the form", "slate"];
      case "SENT":
        return ["Sent to supplier", `${fmtDateTime(d.request?.sent_at)} · ${runningDays} working day${runningDays === 1 ? "" : "s"} so far, no reply yet`, "amber"];
      case "RESPONDED":
        return ["Supplier returned", `${fmtDateTime(d.request?.responded_at)} after ${d.request?.response_working_days} working days${capaToCheck ? " · CAPA to check" : " · to verify"}`, "slate"];
      case "CLOSED":
        return ["Closed", `${fmtDate(d.closed_at)} by ${d.closed_by_name} · supplier answered in ${d.request?.response_working_days} working days`, "emerald"];
      case "VOID":
        return ["Void", d.void_reason ?? "", "red"];
    }
  })();
  const color = { slate: "border-slate-200 bg-slate-50 text-slate-700", amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800", emerald: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[14px] ${color}`}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" />
      </svg>
      <p><span className="font-semibold">{title}</span>{rest && <> · {rest}</>}</p>
    </div>
  );
}

/** "Next step" callout: who acts next, and a button when it is you. */
function NextStep({ d, pending, actor, capaToCheck }: { d: NcfDetail; pending?: NcfDetail["approvals"][number]; actor: Role; capaToCheck: boolean }) {
  const text: Record<NcfDetail["status"], string> = {
    DRAFT: d.history.some((h) => h.decision === "RETURNED")
      ? "QC fixes what the approver asked for and signs again; the approval starts over with a new version."
      : `QC completes the items, status, problem and evidence, then signs and submits.${missingForSubmit(d).length ? ` ${missingForSubmit(d).length} item(s) still missing.` : ""}`,
    WAITING_APPROVAL: `${pending?.signer_name} (${pending?.title}) approves, returns or rejects. Each approval is an electronic signature.`,
    APPROVED: "Purchasing generates the supplier link (the response clock starts), prints the form and sends both to the supplier by email.",
    SENT: "When the supplier's reply arrives by email, Purchasing marks it returned with the reply attached. That stops the clock.",
    RESPONDED: capaToCheck
      ? "Purchasing checks the CAPA read from the reply against the attachment and confirms it, then verifies and closes."
      : "Purchasing verifies the supplier's CAPA and closes the NCF.",
    CLOSED: "Nothing left to do. The record and its signatures can be checked from the QR codes on the printed form.",
    VOID: "Nothing left to do. A new NCF can be raised if the goods still need one.",
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-slate-900">{["CLOSED", "VOID"].includes(d.status) ? "Done" : "Next step"}</div>
          <p className="text-[13px] text-slate-600">{text[d.status]}</p>
        </div>
      </div>
      {actor && actor !== "qc" && <a href="#action" className="btn h-9 text-sm no-underline">Open →</a>}
      {actor === "qc" && <Link href={`/ncf/${d.id}/edit`} className="btn h-9 text-sm no-underline">Open draft →</Link>}
    </div>
  );
}

function ApprovalPanel({ d, pending }: { d: NcfDetail; pending: NcfDetail["approvals"][number] }) {
  return (
    <Section title="Your approval" aside={`Step ${pending.step_no}: ${pending.title}`}>
      <ActionForm action={decideAction} className="grid gap-4 md:grid-cols-[1fr_280px]">
        <input type="hidden" name="id" value={d.id} />
        <div>
          <label htmlFor="comment" className="label">Comment (required to return or reject)</label>
          <textarea id="comment" name="comment" rows={3} className="input" />
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="pw" className="label">Your password, to sign</label>
            <input id="pw" name="password" type="password" required autoComplete="current-password" className="input" />
          </div>
          <p className="text-xs text-slate-600">
            Saya menyetujui isi NCF ini (versi {d.version?.version_no}). Persetujuan ini tercatat dengan nama, jabatan, tanggal dan jam.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Submit name="decision" value="APPROVED">Setujui</Submit>
          <Submit name="decision" value="RETURNED" className="btn">Kembalikan</Submit>
          <Submit name="decision" value="REJECTED" className="btn btn-danger">Tolak</Submit>
        </div>
      </ActionForm>
    </Section>
  );
}

/**
 * Generating the link and recording the reply share one panel, and the link form keeps its place in it: the link is
 * shown only once, and it must stay on screen after the NCF turns Sent and the page refreshes.
 */
function SupplierPanel({ d, runningDays }: { d: NcfDetail; runningDays: number | null }) {
  const sent = d.status === "SENT";
  const reading = extractionConfigured();
  return (
    <Section title={sent ? "Supplier reply" : "Send to supplier"} aside={sent ? `Link ${fmtDateTime(d.request?.sent_at)} · ${runningDays} wd so far` : undefined}>
      <div className="grid gap-5 md:grid-cols-[1fr_300px]">
        <ActionForm action={supplierPanelAction} className={`flex flex-col gap-3 ${sent ? "md:order-2 md:border-l md:border-slate-200 md:pl-5" : ""}`}>
          <input type="hidden" name="id" value={d.id} />
          {sent ? (
            <>
              <p className="text-sm text-slate-700">Supplier lost the link?</p>
              <input type="hidden" name="op" value="reissue" />
              <Submit className="btn w-full">New link</Submit>
              <p className="text-xs text-slate-500">Old links stop working. The clock keeps running from the first link.</p>
              {d.request?.first_opened_at && <p className="text-xs text-slate-600">Opened by the supplier {fmtDateTime(d.request.first_opened_at)}.</p>}
            </>
          ) : (
            <>
              <ol className="list-decimal pl-5 text-sm text-slate-700">
                <li>Generate the link. <span className="font-semibold">The response clock starts now.</span></li>
                <li>Print or save the form as PDF (<Link href={`/print/${d.id}`} target="_blank">Print form</Link>).</li>
                <li>Email the PDF and the link to the supplier from your own mailbox. Contacts are in the Supplier Outbox.</li>
              </ol>
              <div><Submit name="method" value="LINK">Generate link</Submit></div>
              <p className="text-xs text-slate-500">Sending by email from the system comes later.</p>
            </>
          )}
        </ActionForm>
        {sent && (
          <ActionForm action={markReturnedAction} className="flex flex-col gap-3 md:order-1">
            <input type="hidden" name="id" value={d.id} />
            <p className="text-sm text-slate-700">
              The reply came back by email? Attach it (the email saved as PDF or .eml, or the supplier&apos;s attachment) and mark it returned.
              The clock stops at the time you enter.{" "}
              {reading ? "The system then reads the CAPA from it for you to check." : "Automatic reading is not set up, so you will type the CAPA in."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="received_at" className="label">Received at (WIB)</label>
                <input id="received_at" name="received_at" type="datetime-local" required defaultValue={nowWibLocal()} className="input" />
              </div>
              <div>
                <label htmlFor="files" className="label">Supplier&apos;s reply</label>
                <input id="files" name="files" type="file" multiple required className="input h-auto py-2"
                  accept=".pdf,.eml,.msg,.txt,.docx,.xlsx,image/*" />
              </div>
            </div>
            <div>
              <label htmlFor="note" className="label">Note (optional)</label>
              <input id="note" name="note" className="input" placeholder="e.g. replied by Hendra to purchasing@" />
            </div>
            <div><Submit>Mark returned</Submit></div>
          </ActionForm>
        )}
      </div>
    </Section>
  );
}

function CapaCheckPanel({ d }: { d: NcfDetail }) {
  const c = d.capa!;
  const ex = c.extraction;
  const notes = ex?.fields?.notes;
  const replyFiles = d.evidence.filter((e) => e.capa_response_id !== null && e.file_id);
  const keys = Object.keys(CAPA_LABELS) as (keyof typeof CAPA_LABELS)[];
  const value = (k: keyof typeof CAPA_LABELS) => (c[k] ?? "") as string;
  return (
    <Section title="Check the CAPA" aside={ex?.model ? "Read from the reply automatically" : "Type it in from the reply"}>
      <div className="flex flex-col gap-3">
        {ex?.error && <Banner kind="info">{ex.error}</Banner>}
        {ex?.model && (
          <Banner kind="info">
            Read automatically from the supplier&apos;s reply. Check every field against the attachment before confirming: it is not the supplier&apos;s confirmed answer until you do.
            {notes && <span className="mt-1 block font-semibold">Reader&apos;s note: {notes}</span>}
            {ex.skipped?.length > 0 && <span className="mt-1 block">Not readable automatically: {ex.skipped.join(", ")}.</span>}
          </Banner>
        )}
        {replyFiles.length > 0 && (
          <p className="text-sm text-slate-700">
            Reply: {replyFiles.map((f, i) => <span key={f.id}>{i > 0 && ", "}<a href={`/api/files/${f.file_id}`} target="_blank" rel="noreferrer">{f.file_name}</a></span>)}
          </p>
        )}
        <ActionForm action={reviewCapaAction} className="grid gap-3 md:grid-cols-2">
          <input type="hidden" name="id" value={d.id} />
          {keys.map((k) => {
            const long = ["root_cause", "corrective_action", "preventive_action"].includes(k);
            const date = k === "target_date" || k === "effective_from";
            return (
              <div key={k} className={long ? "md:col-span-2" : ""}>
                <label htmlFor={k} className="label">{CAPA_LABELS[k]}{k === "responder_email" && " (optional)"}</label>
                {long ? (
                  <textarea id={k} name={k} rows={2} defaultValue={value(k)} className="input" />
                ) : (
                  <input id={k} name={k} type={date ? "date" : k === "responder_email" ? "email" : "text"} defaultValue={value(k)} className="input" />
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Submit name="confirm" value="1">Confirm CAPA</Submit>
            <Submit name="confirm" value="0" className="btn">Save without confirming</Submit>
          </div>
        </ActionForm>
      </div>
    </Section>
  );
}

function ClosePanel({ d }: { d: NcfDetail }) {
  return (
    <Section title="Verify and close" aside={d.capa?.reviewed_by_name ? `CAPA checked by ${d.capa.reviewed_by_name}` : undefined}>
      <ActionForm action={closeAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={d.id} />
        <div>
          <label htmlFor="close-note" className="label">Hasil verifikasi atas respons supplier</label>
          <textarea id="close-note" name="note" rows={3} required className="input" />
        </div>
        <div><Submit>Close NCF</Submit></div>
      </ActionForm>
    </Section>
  );
}
