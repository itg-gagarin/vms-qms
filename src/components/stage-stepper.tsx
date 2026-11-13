import { Check, X } from "lucide-react";
import type { NcfDetail } from "@/lib/ncf";
import { fmtDate } from "@/lib/util";

type Step = { label: string; sub?: string; date?: Date | null };

/** Where the NCF is in its life: Draft → Approval → Sent → Supplier replied → Closed. Void stops at the step that rejected it. */
export function StageStepper({ d }: { d: NcfDetail }) {
  const chain = d.approvals.filter((a) => a.step_no > 0);
  const signed = chain.filter((a) => a.decision === "APPROVED").length;
  const steps: Step[] = [
    { label: "Draft", sub: d.current_version > 1 ? `version ${d.current_version}` : undefined, date: d.created_at },
    { label: "Approval", sub: chain.length ? `${signed} of ${chain.length} signed` : undefined, date: d.approved_at },
    { label: "Sent to supplier", date: d.request?.sent_at },
    {
      label: "Supplier replied",
      sub: d.request?.response_working_days != null ? `${d.request.response_working_days} working days` : undefined,
      date: d.request?.responded_at,
    },
    { label: "Closed", date: d.closed_at },
  ];
  const current = { DRAFT: 0, WAITING_APPROVAL: 1, APPROVED: 2, SENT: 3, RESPONDED: 4, CLOSED: 5, VOID: 1 }[d.status];
  const voided = d.status === "VOID";

  return (
    <ol className="flex w-full items-start" aria-label="NCF stage">
      {steps.map((s, i) => {
        const done = !voided && i < current;
        const now = !voided && i === current;
        const stopped = voided && i === current;
        const last = i === steps.length - 1;
        return (
          <li key={s.label} className="relative flex flex-1 flex-col items-center text-center" aria-current={now ? "step" : undefined}>
            {!last && <span aria-hidden="true" className={`absolute left-1/2 top-[13px] h-[2px] w-full ${done ? "bg-advance" : "bg-hairline"}`} />}
            <span aria-hidden="true"
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 font-mono text-[12px] font-semibold ${
                done ? "border-advance bg-advance text-advance-ink"
                  : stopped ? "border-status-red bg-status-red text-white"
                  : now ? "border-advance bg-white text-tint-ink ring-4 ring-tint"
                  : "border-slate-300 bg-white text-slate-400"
              }`}>
              {done ? <Check size={14} strokeWidth={3} /> : stopped ? <X size={13} strokeWidth={3} /> : i + 1}
            </span>
            <span className={`mt-2 px-1 text-[13px] leading-tight ${done || now ? "font-semibold text-ink" : stopped ? "font-semibold text-status-red" : "text-muted"}`}>
              {s.label}
              <span className="sr-only">{done ? " (done)" : now ? " (current)" : stopped ? " (stopped here)" : ""}</span>
            </span>
            {(s.sub || (done && s.date)) && (
              <span className="mt-0.5 px-1 font-mono text-[11px] leading-tight text-muted">
                {[s.sub, done && s.date ? fmtDate(s.date) : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
