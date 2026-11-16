// In-app notifications: the internal messages the workflow already queues for a person (notification_outbox rows
// with a recipient user), shown in the top bar. "To do" means the person still has to act on it.
import type { Actor } from "./access";
import { one, pool, q } from "./db";
import { AppError } from "./util";

export type Note = {
  id: number; event: string; title: string; at: Date; read: boolean; ncf_id: number | null; todo: boolean | null;
};

const SELECT = `
  select o.id::int as id, o.event, coalesce(o.payload->>'subject', o.event) as title, o.created_at as at, (o.read_at is not null) as read,
         n.id::int as ncf_id,
         case
           when o.event in ('NCF_SUBMITTED','NCF_STEP_APPROVED') then exists (
             select 1 from ncf_version v join ncf_approval a on a.ncf_version_id = v.id
             where v.ncf_id = n.id and v.version_no = n.current_version and a.approver_id = o.recipient_user_id and a.decision is null
               and n.status = 'WAITING_APPROVAL')
           when o.event = 'NCF_APPROVED' then n.status = 'APPROVED'
           when o.event = 'NCF_RETURNED' then n.status = 'DRAFT'
           when o.event = 'REMINDER' then n.status = 'SENT'
         end as todo
  from notification_outbox o
  left join supplier_request r on o.ref_table = 'supplier_request' and r.id = o.ref_id
  left join ncf n on n.id = case when o.ref_table = 'ncf' then o.ref_id else r.ncf_id end`;

/** The latest notifications for the person, newest first, and how many are unread. */
export async function inbox(actor: Actor, limit = 15) {
  const [items, unread] = await Promise.all([
    q<Note>(pool, `${SELECT} where o.recipient_user_id = $1 order by o.id desc limit $2`, [actor.id, limit]),
    one<{ n: number }>(pool, "select count(*)::int as n from notification_outbox where recipient_user_id = $1 and read_at is null", [actor.id]),
  ]);
  return { items, unread: unread?.n ?? 0 };
}

/** Marks one of the person's own notifications read and returns where it points. */
export async function openNote(actor: Actor, id: number) {
  const row = await one<Note>(pool, `${SELECT} where o.id = $1 and o.recipient_user_id = $2`, [id, actor.id]);
  if (!row) throw new AppError("Notification not found.", 404);
  await pool.query("update notification_outbox set read_at = now() where id = $1 and read_at is null", [id]);
  return row.ncf_id ? `/ncf/${row.ncf_id}` : "/ncf";
}

export async function markAllRead(actor: Actor) {
  await pool.query("update notification_outbox set read_at = now() where recipient_user_id = $1 and read_at is null", [actor.id]);
}
