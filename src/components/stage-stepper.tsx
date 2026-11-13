import type { NcfDetail } from "@/lib/ncf";
import { fmtDate } from "@/lib/util";

type Step = { label: string; sub?: string; date?: Date | null };

/** Where the NCF is in its life: Draft → Approval → Sent → Returned → Closed. Void stops at the step that rejected it. */
export function StageStepper({ d }: { d: NcfDetail }) {
  const chain = d.approvals.filter((a) => a.step_no > 0);
  const signed = chain.filter((a) => a.decision === "APPROVED").length;
  const steps: Step[] = [
    { label: "Draft", sub: d.current_version > 1 ? `version ${d.current_version}` : undefined, date: d.created_at },
    { label: "Approval", sub: chain.length ? `${signed} of ${chain.length} signed` : undefined, date: d.approved_at },
    { label: "Sent to supplier", sub: d.request?.send_method === "LINK" ? "link" : undefined, date: d.request?.sent_at },
    {
      label: "Supplier returned",
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
            {!last && (
              <span aria-hidden="true"
                className={`absolute left-1/2 top-[13px] h-[3px] w-full ${done ? "bg-emerald-500" : "bg-slate-200"}`} />
            )}
            <span aria-hidden="true"
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                done ? "border-emerald-500 bg-emerald-500 text-white"
                  : stopped ? "border-red-600 bg-red-600 text-white"
                  : now ? "border-emerald-500 bg-white text-emerald-700 ring-4 ring-emerald-100"
                  : "border-slate-300 bg-white text-slate-400"
              }`}>
              {done ? (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
              ) : stopped ? (
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              ) : i + 1}
            </span>
            <span className={`mt-2 px-1 text-[13px] leading-tight ${done || now ? "font-semibold text-slate-900" : stopped ? "font-semibold text-red-700" : "text-slate-500"}`}>
              {s.label}
              <span className="sr-only">{done ? " (done)" : now ? " (current)" : stopped ? " (stopped here)" : ""}</span>
            </span>
            {(s.sub || (done && s.date)) && (
              <span className="mt-0.5 px-1 text-[11px] leading-tight text-slate-500">
                {[s.sub, done && s.date ? fmtDate(s.date) : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
