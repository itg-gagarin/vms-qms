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
  SEND: "Generated the supplier link",
  REISSUE_LINK: "Issued a new supplier link",
  SUPPLIER_OPENED: "Supplier opened the link",
  SUPPLIER_RESPONDED: "Supplier answered through the link",
  SUPPLIER_RETURNED: "Recorded the supplier's emailed reply",
  CAPA_READ_FROM_REPLY: "CAPA read from the reply automatically",
  CAPA_NOT_READ: "CAPA could not be read automatically",
  CAPA_EDIT: "Corrected the CAPA",
  CAPA_CONFIRMED: "Confirmed the CAPA",
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
      return { text: `${v} working day${v === "1" ? "" : "s"} after the link` };
    case "CAPA_EDIT":
      return { text: `${(e.field ?? "").replace(/_/g, " ")}: ${v}` };
    case "SEND":
      return null;
    default:
      return { text: v };
  }
}

const dot = (a: string) =>
  a.includes("REJECTED") || a === "CAPA_NOT_READ" ? "bg-red-500"
    : a.includes("RETURNED") && a.startsWith("APPROVAL") ? "bg-amber-500"
    : ["SUBMIT", "APPROVAL_APPROVED", "CLOSE", "CAPA_CONFIRMED", "SUPPLIER_RESPONDED", "SUPPLIER_RETURNED"].includes(a) ? "bg-emerald-500"
    : "bg-slate-300";

/** The audit trail, newest first, always open. */
export function AuditTimeline({ events }: { events: Event[] }) {
  const list = [...events].reverse();
  return (
    <ol className="relative flex flex-col gap-3 border-l border-slate-200 pl-4">
      {list.map((e, i) => {
        const more = detail(e);
        return (
          <li key={i} className="relative">
            <span aria-hidden="true" className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${dot(e.action)}`} />
            <div className="text-[13px] font-semibold text-slate-900">{LABEL[e.action] ?? e.action.replace(/_/g, " ").toLowerCase()}</div>
            <div className="text-[12px] text-slate-500">
              {fmtDateTime(e.at)} · {e.actor_name ?? (e.actor_type === "SUPPLIER" ? "Supplier" : "System")}
            </div>
            {more && <div className="mt-0.5 break-words text-[12px] text-slate-700" title={more.full}>{more.text}</div>}
          </li>
        );
      })}
    </ol>
  );
}
