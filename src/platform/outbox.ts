// Messages to people, queued in the same transaction as the change that caused them. The top-bar notifications
// read the rows addressed to a user; a future SMTP worker would send the ones with an email address.
import type { Role } from "./access";
import type { Db } from "./db";
import { q } from "./db";

type Mail = {
  event: string;
  refTable: string;
  refId: number;
  toEmail?: string | null;
  toUserId?: number | null;
  subject: string;
  body: string;
};

/** Queues an email in the same transaction as the change that caused it. */
export async function enqueue(db: Db, m: Mail) {
  await db.query(
    `insert into notification_outbox(event, ref_table, ref_id, recipient_email, recipient_user_id, template, payload)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [m.event, m.refTable, m.refId, m.toEmail ?? null, m.toUserId ?? null, m.event, JSON.stringify({ subject: m.subject, body: m.body })],
  );
}

export async function usersWithRole(db: Db, roles: Role[]) {
  return q<{ id: number; email: string; name: string }>(
    db,
    `select distinct u.id::int as id, u.email, u.name from app_user u join user_role r on r.user_id = u.id
     where r.role = any($1) and u.active and (r.valid_to is null or r.valid_to >= current_date)`,
    [roles],
  );
}
