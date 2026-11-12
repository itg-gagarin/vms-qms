// Supplier side (no account) and the reminder job (FD sections 10 and 14).
import type { PoolClient } from "pg";
import { audit, enqueue, getSetting, usersWithRole, workingDaysBetween } from "./core";
import { one, pool, q, tx } from "./db";
import { LIMITS, saveFile } from "./files";
import { getNcf, supplierLink } from "./ncf";
import { AppError, appUrl, randomToken, sha256, wib } from "./util";

type TokenRow = { token_id: number; request_id: number; ncf_id: number; status: string; expires_at: Date; revoked_at: Date | null };

async function findToken(db: PoolClient | typeof pool, raw: string) {
  if (!raw || raw.length < 20) return undefined;
  return one<TokenRow>(
    db,
    `select t.id as token_id, t.request_id, r.ncf_id, r.status, t.expires_at, t.revoked_at
     from access_token t join supplier_request r on r.id = t.request_id where t.token_hash = $1`,
    [sha256(raw)],
  );
}

function checkUsable(t: TokenRow | undefined, now: Date) {
  if (!t) throw new AppError("This link is not valid.", 404);
  if (t.revoked_at) throw new AppError("This link was replaced by a newer one. Please use the latest email or ask Integra Purchasing.", 410);
  if (t.expires_at < now) throw new AppError("This link has expired. Please ask Integra Purchasing for a new one.", 410);
}

/** Opens the supplier page. Records the first open as 'Diterima supplier'. */
export async function openForSupplier(raw: string, now = new Date()) {
  const t = await findToken(pool, raw);
  checkUsable(t, now);
  const updated = await pool.query(
    "update supplier_request set first_opened_at = $2 where id = $1 and first_opened_at is null",
    [t!.request_id, now],
  );
  if (updated.rowCount) {
    await audit(pool, { entity: "ncf", entityId: t!.ncf_id, action: "SUPPLIER_OPENED", actorType: "SUPPLIER" });
  }
  const ncf = await getNcf(null, t!.ncf_id);
  return { ncf, canRespond: t!.status === "SENT" };
}

export async function supplierFileAllowed(raw: string, fileId: number, now = new Date()) {
  const t = await findToken(pool, raw);
  checkUsable(t, now);
  const ok = await one(
    pool,
    `select 1 from evidence e where e.file_id = $1 and (e.ncf_id = $2 or e.capa_response_id in
       (select id from capa_response where request_id = $3))`,
    [fileId, t!.ncf_id, t!.request_id],
  );
  if (!ok) throw new AppError("File not found.", 404);
}

export type CapaInput = {
  root_cause: string;
  corrective_action: string;
  target_date: string;
  preventive_action: string;
  effective_from: string;
  responder_name: string;
  responder_position: string;
  responder_email: string;
  confirm: boolean;
};

export async function respond(raw: string, f: CapaInput, files: File[], meta: { ip?: string; userAgent?: string }, now = new Date()) {
  return tx(async (c) => {
    const t = await findToken(c, raw);
    checkUsable(t, now);
    const r = await one<{ id: number; status: string; sent_at: Date; ncf_id: number }>(
      c,
      "select id, status, sent_at, ncf_id from supplier_request where id = $1 for update",
      [t!.request_id],
    );
    if (r!.status !== "SENT") throw new AppError("A response was already submitted for this NCF.", 409);
    const required: [keyof CapaInput, string][] = [
      ["root_cause", "Akar masalah"],
      ["corrective_action", "Corrective action"],
      ["target_date", "Target selesai"],
      ["preventive_action", "Preventive action"],
      ["effective_from", "Berlaku mulai"],
      ["responder_name", "Nama penanggung jawab"],
      ["responder_position", "Jabatan"],
      ["responder_email", "Email"],
    ];
    const missing = required.filter(([k]) => !String(f[k] ?? "").trim()).map(([, l]) => l);
    if (missing.length) throw new AppError("Please fill: " + missing.join(", ") + ".");
    if (!f.confirm) throw new AppError("Please tick the statement that this response represents your company.");
    if (f.target_date < wib(now).date) throw new AppError("Target selesai cannot be in the past.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.responder_email.trim())) throw new AppError("Email is not valid.");
    if (files.length > LIMITS.filesPerCapa) throw new AppError(`At most ${LIMITS.filesPerCapa} files.`);
    const cr = await one<{ id: number }>(
      c,
      `insert into capa_response(request_id, root_cause, corrective_action, target_date, preventive_action, effective_from,
         responder_name, responder_position, responder_email, submitted_at, ip, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [
        r!.id, f.root_cause.trim(), f.corrective_action.trim(), f.target_date, f.preventive_action.trim(), f.effective_from,
        f.responder_name.trim(), f.responder_position.trim(), f.responder_email.trim(), now, meta.ip ?? null, meta.userAgent ?? null,
      ],
    );
    for (const file of files) {
      const saved = await saveFile(c, file);
      await c.query("insert into evidence(capa_response_id, file_id, kind) values ($1,$2,$3)", [cr!.id, saved.id, saved.kind]);
    }
    const wd = await workingDaysBetween(c, r!.sent_at, now);
    await c.query(
      "update supplier_request set status='RESPONDED', responded_at=$2, response_working_days=$3 where id=$1",
      [r!.id, now, wd],
    );
    await c.query("update ncf set status='RESPONDED' where id=$1", [r!.ncf_id]);
    await audit(c, { entity: "ncf", entityId: r!.ncf_id, action: "SUPPLIER_RESPONDED", field: "working_days", newValue: String(wd), actorType: "SUPPLIER" });
    const n = await one<{ ncf_no: string; created_by: number; supplier: string }>(
      c,
      "select n.ncf_no, n.created_by, s.name as supplier from ncf n join supplier s on s.id = n.supplier_id where n.id = $1",
      [r!.ncf_id],
    );
    const notify = new Set<number>([n!.created_by, ...(await usersWithRole(c, ["PURCHASING"])).map((u) => u.id)]);
    for (const uid of notify) {
      await enqueue(c, {
        event: "NCF_RESPONDED", refTable: "ncf", refId: r!.ncf_id, toUserId: uid,
        subject: `${n!.supplier} answered NCF ${n!.ncf_no}`, body: `Verify and close: ${appUrl()}/ncf/${r!.ncf_id}`,
      });
    }
    return { workingDays: wd };
  });
}

/**
 * Daily job. A reminder is due when the window (working days, Settings) has passed since sending,
 * or since the last reminder, and the CAPA is not returned. Stops at the maximum in Settings.
 * Purchasing is always notified; the supplier only when it has an email contact.
 */
export async function runReminders(now = new Date()) {
  const sent: { ncf_no: string; seq: number; toSupplier: boolean }[] = [];
  const open = await q<{ id: number; ncf_id: number; sent_at: Date; supplier_id: number; ncf_no: string; supplier: string; done: number }>(
    pool,
    `select r.id, r.ncf_id, r.sent_at, r.supplier_id, n.ncf_no, s.name as supplier,
            (select count(*)::int from reminder m where m.request_id = r.id) as done
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
      const contacts = await q<{ name: string; email: string }>(
        c,
        "select name, email from supplier_contact where supplier_id = $1 and active and is_ncf_recipient and email is not null",
        [r.supplier_id],
      );
      if (contacts.length) {
        // A fresh link; earlier links stay valid so a link shared by hand keeps working.
        const days = await getSetting(c, "token_valid_days", now);
        const raw = randomToken();
        await c.query(
          "insert into access_token(request_id, token_hash, expires_at, created_at) values ($1,$2,$3,$4)",
          [r.id, sha256(raw), new Date(now.getTime() + days * 86400000), now],
        );
        for (const ct of contacts) {
          await enqueue(c, {
            event: "REMINDER", refTable: "supplier_request", refId: r.id, toEmail: ct.email,
            subject: `Reminder ${seq}: please answer NCF ${r.ncf_no} – Integra Group`,
            body: `Dear ${ct.name},\n\nWe have not yet received your corrective and preventive action for NCF ${r.ncf_no}.\n${supplierLink(raw)}`,
          });
        }
      }
      const last = seq >= max;
      for (const u of await usersWithRole(c, ["PURCHASING"])) {
        await enqueue(c, {
          event: "REMINDER", refTable: "supplier_request", refId: r.id, toUserId: u.id,
          subject: `${r.supplier} has not answered NCF ${r.ncf_no} (reminder ${seq} of ${max})`,
          body:
            (contacts.length ? "A reminder email was sent to the supplier." : "The supplier has no email contact. Please follow up by phone or the channel you used.") +
            (last ? "\nThis was the last automatic reminder." : "") +
            `\n${appUrl()}/ncf/${r.ncf_id}`,
        });
      }
      await c.query(
        "insert into reminder(request_id, seq_no, sent_at, to_supplier, to_purchasing) values ($1,$2,$3,$4,true)",
        [r.id, seq, now, contacts.length > 0],
      );
      await audit(c, { entity: "ncf", entityId: r.ncf_id, action: "REMINDER", field: "seq", newValue: String(seq), actorType: "SYSTEM" });
      sent.push({ ncf_no: r.ncf_no, seq, toSupplier: contacts.length > 0 });
    });
  }
  return sent;
}
