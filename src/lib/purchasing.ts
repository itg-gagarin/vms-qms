// Purchasing's side of the supplier exchange: the dispatch table, recording a reply that came back by email
// ("Returned", which stops the response clock), and checking the CAPA read from it before closing.
import type { Actor } from "./core";
import { audit, enqueue, requireRole, workingDaysBetween } from "./core";
import { one, pool, q, tx } from "./db";
import { claudeExtractor, ExtractionError, extractionConfigured, type Extraction, type Extractor } from "./extract";
import { LIMITS, saveFile } from "./files";
import type { NcfStatus } from "./labels";
import { AppError, appUrl, wib } from "./util";

const PURCHASING = ["PURCHASING", "PCH_DIV_HEAD"] as const;

export type CapaFields = {
  root_cause: string;
  corrective_action: string;
  target_date: string;
  preventive_action: string;
  effective_from: string;
  responder_name: string;
  responder_position: string;
  responder_email: string;
};
const CAPA_KEYS: (keyof CapaFields)[] = [
  "root_cause", "corrective_action", "target_date", "preventive_action", "effective_from",
  "responder_name", "responder_position", "responder_email",
];
export const CAPA_LABELS: Record<keyof CapaFields, string> = {
  root_cause: "Akar masalah",
  corrective_action: "Corrective action",
  target_date: "Target selesai",
  preventive_action: "Preventive action",
  effective_from: "Berlaku mulai",
  responder_name: "Penanggung jawab",
  responder_position: "Jabatan",
  responder_email: "Email",
};
const DATE_KEYS = new Set<keyof CapaFields>(["target_date", "effective_from"]);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Trims every field; empty becomes null. Dates that are not YYYY-MM-DD are dropped (Purchasing fills them in). */
function clean(f: Partial<CapaFields> | undefined) {
  const out = {} as Record<keyof CapaFields, string | null>;
  for (const k of CAPA_KEYS) {
    const v = String(f?.[k] ?? "").trim();
    out[k] = v && (!DATE_KEYS.has(k) || isDate(v)) ? v : null;
  }
  return out;
}

/** "2026-11-12T14:30" as typed in the form, in WIB. */
export function parseWib(local: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new AppError("Received at must be a date and time.");
  return new Date(`${local}:00+07:00`);
}

function checkReceived(received: Date, sentAt: Date, now: Date) {
  // The form takes minutes, so compare from the start of the minute the link was generated in.
  if (received.getTime() < Math.floor(sentAt.getTime() / 60_000) * 60_000) {
    throw new AppError("The reply cannot arrive before the link was generated.");
  }
  if (received.getTime() > now.getTime() + 60_000) throw new AppError("Received at cannot be in the future.");
}

export type ReturnInput = { receivedAt: Date; files: File[]; note: string };

/**
 * The supplier's reply came back by email. Stops the response clock at `receivedAt`, keeps the reply files,
 * and reads the CAPA from them (a draft until Purchasing confirms it). Reading happens before the database
 * transaction so a slow model call never holds a lock.
 */
export async function markReturned(actor: Actor, ncfId: number, input: ReturnInput, opts: { extractor?: Extractor; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  requireRole(actor, [...PURCHASING]);
  const files = input.files.filter((f) => f.size > 0);
  if (files.length === 0) throw new AppError("Attach the supplier's reply (the email saved as PDF or .eml, or its attachment).");
  if (files.length > LIMITS.filesPerCapa) throw new AppError(`At most ${LIMITS.filesPerCapa} files.`);

  const pre = await one<{ status: NcfStatus; sent_at: Date | null; ncf_no: string; supplier: string }>(
    pool,
    `select n.status, r.sent_at, n.ncf_no, s.name as supplier from ncf n join supplier s on s.id = n.supplier_id
     left join supplier_request r on r.ncf_id = n.id where n.id = $1`,
    [ncfId],
  );
  if (!pre) throw new AppError("NCF not found.", 404);
  if (pre.status !== "SENT" || !pre.sent_at) throw new AppError("Only an NCF waiting for the supplier can be marked returned.", 409);
  checkReceived(input.receivedAt, pre.sent_at, now);

  let extraction: Extraction | null = null;
  let extractionError: string | null = null;
  const extractor = opts.extractor ?? (extractionConfigured() ? claudeExtractor : undefined);
  if (!extractor) {
    extractionError = "Automatic reading is not set up on this server. Type the CAPA in from the reply.";
  } else {
    try {
      const replies = await Promise.all(files.map(async (f) => ({ name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) })));
      extraction = await extractor(replies, { ncfNo: pre.ncf_no, supplier: pre.supplier });
    } catch (e) {
      extractionError = e instanceof ExtractionError ? e.message : "Automatic reading failed. Type the CAPA in from the reply.";
      if (!(e instanceof ExtractionError)) console.error("CAPA extraction failed", e);
    }
  }

  return tx(async (c) => {
    const n = await one<{ status: NcfStatus; created_by: number; ncf_no: string }>(
      c, "select status, created_by, ncf_no from ncf where id = $1 for update", [ncfId],
    );
    if (n!.status !== "SENT") throw new AppError("Only an NCF waiting for the supplier can be marked returned.", 409);
    const r = await one<{ id: number; sent_at: Date }>(c, "select id, sent_at from supplier_request where ncf_id = $1 for update", [ncfId]);
    checkReceived(input.receivedAt, r!.sent_at, now);
    const f = clean(extraction?.fields);
    const cr = await one<{ id: number }>(
      c,
      `insert into capa_response(request_id, root_cause, corrective_action, target_date, preventive_action, effective_from,
         responder_name, responder_position, responder_email, submitted_at, received_via, recorded_by, extraction)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PURCHASING',$11,$12) returning id`,
      [
        r!.id, f.root_cause, f.corrective_action, f.target_date, f.preventive_action, f.effective_from,
        f.responder_name, f.responder_position, f.responder_email, input.receivedAt, actor.id,
        JSON.stringify({ at: now.toISOString(), model: extraction?.model ?? null, fields: extraction?.fields ?? null,
          skipped: extraction?.skipped ?? [], error: extractionError }),
      ],
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
    await audit(c, {
      entity: "ncf", entityId: ncfId, action: extraction ? "CAPA_READ_FROM_REPLY" : "CAPA_NOT_READ",
      newValue: extraction ? extraction.model : extractionError, actorType: "SYSTEM",
    });
    await enqueue(c, {
      event: "NCF_RESPONDED", refTable: "ncf", refId: ncfId, toUserId: n!.created_by,
      subject: `Supplier reply received for NCF ${n!.ncf_no}`, body: `${appUrl()}/ncf/${ncfId}`,
    });
    return { workingDays: wd, extracted: Boolean(extraction), extractionError };
  });
}

/**
 * Purchasing checks the CAPA read from an emailed reply and corrects it. Each change is logged with the old and new
 * value. `confirm` marks it checked; closing needs that. A CAPA the supplier typed through the link is theirs and stays as sent.
 */
export async function reviewCapa(actor: Actor, ncfId: number, input: Partial<CapaFields>, confirm: boolean, now = new Date()) {
  return tx(async (c) => {
    requireRole(actor, [...PURCHASING]);
    const n = await one<{ status: NcfStatus }>(c, "select status from ncf where id = $1 for update", [ncfId]);
    if (!n) throw new AppError("NCF not found.", 404);
    if (n.status !== "RESPONDED") throw new AppError("The CAPA can be checked only while the NCF waits for verification.", 409);
    const cur = await one<Record<keyof CapaFields, string | null> & { id: number; received_via: string }>(
      c,
      `select cr.id, cr.received_via, cr.root_cause, cr.corrective_action, to_char(cr.target_date, 'YYYY-MM-DD') as target_date,
              cr.preventive_action, to_char(cr.effective_from, 'YYYY-MM-DD') as effective_from,
              cr.responder_name, cr.responder_position, cr.responder_email
       from capa_response cr join supplier_request r on r.id = cr.request_id
       where r.ncf_id = $1 and not cr.is_addendum for update of cr`,
      [ncfId],
    );
    if (!cur) throw new AppError("No supplier reply is recorded yet.", 409);
    if (cur.received_via !== "PURCHASING") throw new AppError("The supplier sent this CAPA through the link; it stays as they wrote it.", 409);
    for (const k of DATE_KEYS) {
      const v = String(input[k] ?? "").trim();
      if (v && !isDate(v)) throw new AppError(`${CAPA_LABELS[k]} must be a date.`);
    }
    const email = String(input.responder_email ?? "").trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("Email is not valid.");
    const next = clean(input);
    for (const k of CAPA_KEYS) {
      if (next[k] === cur[k]) continue;
      await c.query(`update capa_response set ${k} = $2 where id = $1`, [cur.id, next[k]]);
      await audit(c, { entity: "ncf", entityId: ncfId, action: "CAPA_EDIT", field: k, oldValue: cur[k], newValue: next[k], actorType: "USER", actorId: actor.id });
    }
    if (confirm) {
      const missing = CAPA_KEYS.filter((k) => k !== "responder_email" && !next[k]).map((k) => CAPA_LABELS[k]);
      if (missing.length) throw new AppError("Fill before confirming: " + missing.join(", ") + ".");
      await c.query("update capa_response set reviewed_at = $2, reviewed_by = $3 where id = $1", [cur.id, now, actor.id]);
      await audit(c, { entity: "ncf", entityId: ncfId, action: "CAPA_CONFIRMED", actorType: "USER", actorId: actor.id });
    }
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

/** Purchasing's table: every NCF from approval to closure with the supplier's contacts and the response clock. */
export async function listDispatch(actor: Actor, tab: DispatchTab) {
  requireRole(actor, [...PURCHASING]);
  const statuses = (DISPATCH_TABS.find((t) => t.key === tab) ?? DISPATCH_TABS[0]).statuses;
  return q<{
    id: number; ncf_no: string; status: NcfStatus; supplier: string; supplier_code: string; po_no: string | null;
    approved_at: Date | null; sent_at: Date | null; send_method: string | null; responded_at: Date | null;
    working_days: number | null; running: boolean; reminders: number; received_via: string | null; reviewed: boolean;
    contacts: { name: string; email: string | null; phone: string | null }[];
  }>(
    pool,
    `select n.id, n.ncf_no, n.status, s.name as supplier, s.sap_vendor_code as supplier_code, po.po_no, n.approved_at,
            r.sent_at, r.send_method, r.responded_at,
            coalesce(r.response_working_days,
              case when r.sent_at is not null then (
                select count(*)::int from calendar_day d where d.is_working
                  and d.day > (r.sent_at at time zone 'Asia/Jakarta')::date
                  and d.day <= (now() at time zone 'Asia/Jakarta')::date) end) as working_days,
            (r.sent_at is not null and r.responded_at is null) as running,
            (select count(*)::int from reminder m where m.request_id = r.id) as reminders,
            cr.received_via, (cr.reviewed_at is not null) as reviewed,
            coalesce((select json_agg(json_build_object('name', sc.name, 'email', sc.email, 'phone', sc.phone) order by sc.id)
                      from supplier_contact sc where sc.supplier_id = s.id and sc.active), '[]') as contacts
     from ncf n
     join supplier s on s.id = n.supplier_id
     left join purchase_order po on po.id = n.po_id
     left join supplier_request r on r.ncf_id = n.id
     left join capa_response cr on cr.request_id = r.id and not cr.is_addendum
     where n.status = any($1)
     order by case n.status when 'APPROVED' then 0 when 'SENT' then 1 when 'RESPONDED' then 2 else 3 end,
              coalesce(r.sent_at, n.approved_at) asc nulls last
     limit 300`,
    [statuses],
  );
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
