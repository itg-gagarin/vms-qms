import { fmtDateTime } from "@/lib/util";

type Event = { at: Date; action: string; field: string | null; new_value: string | null; actor_type: string; actor_name: string | null };

const LABEL: Record<string, string> = {
  CREATE: "Created the draft",
  EDIT_HEADER: "Edited the details",
  ADD_ITEM: "Added an item",
  REMOVE_ITEM: "Removed an item",
  ADD_EVIDENCE: "Added evidence",
  REMOVE_EVIDENCE: "Removed evidence",
  SUBMIT: "Signed and submitted",
  APPROVAL_APPROVED: "Approved and signed",
  APPROVAL_RETURNED: "Returned to QC",
  APPROVAL_REJECTED: "Rejected",
  SET_PO: "Set the PO",
  SENT: "Sent the form to the supplier",
  SEND: "Generated the supplier link",
  REISSUE_LINK: "Issued a new supplier link",
  SUPPLIER_OPENED: "Supplier opened the link",
  SUPPLIER_RESPONDED: "Supplier answered through the link",
  SUPPLIER_RETURNED: "Recorded the supplier's emailed reply",
  CLOSE: "Verified and closed",
  REMINDER: "Reminder sent",
};

/** What to show under the event, in plain words. Long hashes are shortened; the full value is in the title. */
function detail(e: Event) {
  const v = e.new_value;
  if (!v) return null;
  switch (e.action) {
    case "SUBMIT": {
      const [version, hash] = v.split(" ");
      return { text: `Version ${version} · content hash ${hash?.slice(0, 12)}…`, full: v };
    }
    case "ADD_ITEM": case "ADD_EVIDENCE": case "REMOVE_ITEM": case "REMOVE_EVIDENCE": case "CREATE":
      return e.action === "ADD_EVIDENCE" ? { text: `${v} file${v === "1" ? "" : "s"}` } : null;
    case "SUPPLIER_RETURNED": case "SUPPLIER_RESPONDED":
      return { text: `${v} working day${v === "1" ? "" : "s"} after sending` };
    case "CAPA_EDIT":
      return { text: `${(e.field ?? "").replace(/_/g, " ")}: ${v}` };
    case "SEND": case "SENT":
      return null;
    case "SET_PO":
      return { text: `PO ${v}` };
    default:
      return { text: v };
  }
}

const tone = (a: string) =>
  a.includes("REJECTED") ? "bg-status-red ring-red-100"
    : a.includes("RETURNED") && a.startsWith("APPROVAL") ? "bg-status-amber ring-amber-100"
    : ["SUBMIT", "APPROVAL_APPROVED", "CLOSE", "SENT", "SUPPLIER_RESPONDED", "SUPPLIER_RETURNED"].includes(a) ? "bg-advance ring-tint"
    : "bg-slate-300 ring-slate-100";

/**
 * The audit trail, newest first, always open. Each event has its own marker column, so the dots and the line
 * between them are drawn inside the box (never clipped by a scrolling parent).
 */
export function AuditTimeline({ events }: { events: Event[] }) {
  const list = [...events].reverse();
  return (
    <ol className="flex flex-col">
      {list.map((e, i) => {
        const more = detail(e);
        const last = i === list.length - 1;
        return (
          <li key={i} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3">
            <div className="relative flex justify-center" aria-hidden="true">
              {!last && <span className="absolute bottom-0 top-4 w-px bg-hairline" />}
              <span className={`relative mt-1.5 size-2.5 rounded-full ring-4 ${tone(e.action)}`} />
            </div>
            <div className={last ? "" : "pb-4"}>
              <div className="text-[13px] font-semibold leading-snug text-ink">{LABEL[e.action] ?? e.action.replace(/_/g, " ").toLowerCase()}</div>
              <div className="num mt-0.5 text-[11px] text-muted">
                {fmtDateTime(e.at)} · <span className="font-sans">{e.actor_name ?? (e.actor_type === "SUPPLIER" ? "Supplier" : "System")}</span>
              </div>
              {more && <div className="mt-1 break-words text-[12px] text-slate-700" title={more.full}>{more.text}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
