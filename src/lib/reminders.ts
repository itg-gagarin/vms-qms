// The daily reminder job (FD section 14). Nothing goes to the supplier from the system: Purchasing is reminded to
// follow up with the supplier themselves.
import { audit, enqueue, getSetting, usersWithRole, workingDaysBetween } from "./core";
import { one, pool, q, tx } from "./db";
import { appUrl } from "./util";

/**
 * A reminder is due when the window (working days, Settings) has passed since the form was sent, or since the last
 * reminder, and the supplier's reply has not come back. Stops at the maximum in Settings.
 */
export async function runReminders(now = new Date()) {
  const sent: { ncf_no: string; seq: number }[] = [];
  const open = await q<{ id: number; ncf_id: number; sent_at: Date; ncf_no: string; supplier: string }>(
    pool,
    `select r.id, r.ncf_id, r.sent_at, n.ncf_no, s.name as supplier
     from supplier_request r join ncf n on n.id = r.ncf_id join supplier s on s.id = r.supplier_id
     where r.status = 'SENT' and r.type = 'NCF' and r.sent_at <= $1`,
    [now],
  );
  for (const r of open) {
    await tx(async (c) => {
      const window = await getSetting(c, "reminder_window_wd", r.sent_at);
      const max = await getSetting(c, "reminder_max", r.sent_at);
      const lock = await one<{ done: number }>(
        c,
        "select (select count(*)::int from reminder where request_id = $1) as done from supplier_request where id = $1 and status = 'SENT' for update",
        [r.id],
      );
      if (!lock || lock.done >= max) return;
      const elapsed = await workingDaysBetween(c, r.sent_at, now);
      if (elapsed < window * (lock.done + 1)) return;
      const seq = lock.done + 1;
      for (const u of await usersWithRole(c, ["PURCHASING"])) {
        await enqueue(c, {
          event: "REMINDER", refTable: "supplier_request", refId: r.id, toUserId: u.id,
          subject: `${r.supplier} has not replied to NCF ${r.ncf_no} (reminder ${seq} of ${max})`,
          body: `Please follow up with the supplier.${seq >= max ? "\nThis was the last automatic reminder." : ""}\n${appUrl()}/ncf/${r.ncf_id}`,
        });
      }
      await c.query(
        "insert into reminder(request_id, seq_no, sent_at, to_supplier, to_purchasing) values ($1,$2,$3,false,true)",
        [r.id, seq, now],
      );
      await audit(c, { entity: "ncf", entityId: r.ncf_id, action: "REMINDER", field: "seq", newValue: String(seq), actorType: "SYSTEM" });
      sent.push({ ncf_no: r.ncf_no, seq });
    });
  }
  return sent;
}
