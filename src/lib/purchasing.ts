// Purchasing's side of the supplier exchange: the Supplier Outbox table, and recording that the supplier's reply came
// back by email ("Returned"), which stops the response clock. The CAPA itself stays in the supplier's reply file:
// the system keeps the file and the times, and does not re-type or interpret what the supplier wrote.
import type { Actor } from "./core";
import { audit, enqueue, requireRole, workingDaysBetween } from "./core";
import { one, pool, q, tx } from "./db";
import { LIMITS, saveFile } from "./files";
import type { NcfStatus } from "./labels";
import { AppError, appUrl, wib } from "./util";

const PURCHASING = ["PURCHASING", "PCH_DIV_HEAD"] as const;

/** "2026-11-12T14:30" as typed in the form, in WIB. */
export function parseWib(local: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new AppError("Enter a date and time.");
  return new Date(`${local}:00+07:00`);
}

function checkReceived(received: Date, sentAt: Date, now: Date) {
  // The form takes minutes, so compare from the start of the minute the form was sent in.
  if (received.getTime() < Math.floor(sentAt.getTime() / 60_000) * 60_000) {
    throw new AppError("The reply cannot arrive before the form was sent.");
  }
  if (received.getTime() > now.getTime() + 60_000) throw new AppError("Received at cannot be in the future.");
}

export type ReturnInput = { receivedAt: Date; files: File[]; note: string };

/** The supplier's reply came back by email. Stops the response clock at `receivedAt` and keeps the reply files. */
export async function markReturned(actor: Actor, ncfId: number, input: ReturnInput, now = new Date()) {
  requireRole(actor, [...PURCHASING]);
  const files = input.files.filter((f) => f.size > 0);
  if (files.length === 0) throw new AppError("Attach the supplier's reply (the email saved as PDF or .eml, or the filled-in form).");
  if (files.length > LIMITS.filesPerCapa) throw new AppError(`At most ${LIMITS.filesPerCapa} files.`);
  return tx(async (c) => {
    const n = await one<{ status: NcfStatus; created_by: number; ncf_no: string }>(
      c, "select status, created_by, ncf_no from ncf where id = $1 for update", [ncfId],
    );
    if (!n) throw new AppError("NCF not found.", 404);
    if (n.status !== "SENT") throw new AppError("Only an NCF waiting for the supplier can be marked returned.", 409);
    const r = await one<{ id: number; sent_at: Date }>(c, "select id, sent_at from supplier_request where ncf_id = $1 for update", [ncfId]);
    checkReceived(input.receivedAt, r!.sent_at, now);
    // The reply record holds the files; its CAPA fields stay empty because the CAPA is in the file.
    const cr = await one<{ id: number }>(
      c,
      `insert into capa_response(request_id, submitted_at, received_via, recorded_by) values ($1,$2,'PURCHASING',$3) returning id`,
      [r!.id, input.receivedAt, actor.id],
    );
    for (const file of files) {
      const saved = await saveFile(c, file);
      await c.query("insert into evidence(capa_response_id, file_id, kind, uploaded_by) values ($1,$2,$3,$4)", [cr!.id, saved.id, saved.kind, actor.id]);
    }
    if (input.note.trim()) {
      await c.query("insert into evidence(capa_response_id, kind, caption, uploaded_by) values ($1,'NOTE',$2,$3)", [cr!.id, input.note.trim(), actor.id]);
    }
    const wd = await workingDaysBetween(c, r!.sent_at, input.receivedAt);
    await c.query("update supplier_request set status='RESPONDED', responded_at=$2, response_working_days=$3 where id=$1", [r!.id, input.receivedAt, wd]);
    await c.query("update ncf set status='RESPONDED' where id=$1", [ncfId]);
    await audit(c, { entity: "ncf", entityId: ncfId, action: "SUPPLIER_RETURNED", field: "working_days", newValue: String(wd), actorType: "USER", actorId: actor.id });
    await enqueue(c, {
      event: "NCF_RESPONDED", refTable: "ncf", refId: ncfId, toUserId: n.created_by,
      subject: `Supplier reply received for NCF ${n.ncf_no}`, body: `${appUrl()}/ncf/${ncfId}`,
    });
    return { workingDays: wd };
  });
}

export type DispatchTab = "send" | "waiting" | "returned" | "closed" | "all";
export const DISPATCH_TABS: { key: DispatchTab; label: string; statuses: NcfStatus[] }[] = [
  { key: "send", label: "To send", statuses: ["APPROVED"] },
  { key: "waiting", label: "Waiting reply", statuses: ["SENT"] },
  { key: "returned", label: "Returned · to verify", statuses: ["RESPONDED"] },
  { key: "closed", label: "Closed", statuses: ["CLOSED"] },
  { key: "all", label: "All", statuses: ["APPROVED", "SENT", "RESPONDED", "CLOSED"] },
];

export type DispatchRow = {
  id: number; ncf_no: string; status: NcfStatus; supplier: string; supplier_code: string; po_no: string | null;
  approved_at: Date | null; sent_at: Date | null; responded_at: Date | null; working_days: number | null; running: boolean;
  reminders: number; contacts: { name: string; email: string | null; phone: string | null }[];
};

/** Purchasing's table, one page at a time: every NCF from approval to closure with the supplier's contacts and the clock. */
export async function listDispatch(actor: Actor, tab: DispatchTab, page = 1, size = 20) {
  requireRole(actor, [...PURCHASING]);
  const statuses = (DISPATCH_TABS.find((t) => t.key === tab) ?? DISPATCH_TABS[0]).statuses;
  const total = (await one<{ n: number }>(pool, "select count(*)::int as n from ncf where status = any($1)", [statuses]))!.n;
  const rows = await q<DispatchRow>(
    pool,
    `select n.id, n.ncf_no, n.status, s.name as supplier, s.sap_vendor_code as supplier_code, po.po_no, n.approved_at,
            r.sent_at, r.responded_at,
            coalesce(r.response_working_days, case when r.sent_at is not null then working_days_between(r.sent_at, now()) end) as working_days,
            (r.sent_at is not null and r.responded_at is null) as running,
            (select count(*)::int from reminder m where m.request_id = r.id) as reminders,
            coalesce((select json_agg(json_build_object('name', sc.name, 'email', sc.email, 'phone', sc.phone) order by sc.id)
                      from supplier_contact sc where sc.supplier_id = s.id and sc.active), '[]') as contacts
     from ncf n
     join supplier s on s.id = n.supplier_id
     left join purchase_order po on po.id = n.po_id
     left join supplier_request r on r.ncf_id = n.id
     where n.status = any($1)
     order by case n.status when 'APPROVED' then 0 when 'SENT' then 1 when 'RESPONDED' then 2 else 3 end,
              coalesce(r.sent_at, n.approved_at) asc nulls last, n.id
     limit $2 offset $3`,
    [statuses, size, (page - 1) * size],
  );
  return { rows, total };
}

/** The reminder window from Settings, for flagging replies that are late. */
export async function reminderWindow() {
  const row = await one<{ value: unknown }>(
    pool, "select value from setting where key = 'reminder_window_wd' and valid_from <= now() order by valid_from desc limit 1",
  );
  return Number(row?.value ?? 2);
}

export const nowWibLocal = () => {
  const t = wib(new Date());
  return `${t.date}T${t.time}`;
};
