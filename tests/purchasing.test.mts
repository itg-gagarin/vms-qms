import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { at, photo, rebuildDb } from "./helpers.mts";

const { pool, one, q } = await import("../src/lib/db.ts");
const { loadActor } = await import("../src/lib/core.ts");
const ncf = await import("../src/lib/ncf.ts");
const pur = await import("../src/lib/purchasing.ts");

type Actor = NonNullable<Awaited<ReturnType<typeof loadActor>>>;
const users: Record<string, Actor> = {};
const PW = "demo1234";

before(async () => {
  rebuildDb();
  for (const l of ["qc", "qcm", "whs", "gm", "pur", "pch", "admin"]) {
    const u = await one<{ id: number }>(pool, "select id from app_user where email = $1", [`${l}@demo.local`]);
    users[l] = (await loadActor(pool, u!.id))!;
  }
});
after(async () => pool.end());

/** An NCF whose exported form Purchasing sent at `sentAt` (WIB). */
async function sentNcf(sentAt: string) {
  const mr = (await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = '260012841'"))!.id;
  const id = await ncf.createDraft(users.qc, mr, at("2026-11-02 08:00"));
  await ncf.updateHeader(users.qc, id, {
    inspect_date: "2026-11-02", inspect_time: "08:00", goods_status: "FAILED", hold_note: "",
    problem_category_id: "1", problem_desc: "Printing jelek di bagian belakang box.", follow_up: "Retur semua.",
  });
  const [l] = await ncf.mrregLines(id);
  await ncf.addItem(users.qc, id, l.id, 10, 2, 100);
  await ncf.addEvidence(users.qc, id, [photo("x.png", String(id))], "");
  await ncf.submit(users.qc, id, PW, at("2026-11-02 09:00"));
  for (const who of ["qcm", "whs", "gm"]) await ncf.decide(users[who], id, "APPROVED", PW, "", at("2026-11-02 10:00"));
  await ncf.markSent(users.pur, id, at(sentAt));
  return id;
}

const reply = () => new File([Buffer.from("Dear Integra, root cause: ink ran out on the night shift.")], "reply.eml", { type: "message/rfc822" });

describe("Purchasing records the supplier's emailed reply (Returned)", () => {
  let id = 0;

  test("only Purchasing can mark returned; the reply must be attached and not predate sending", async () => {
    id = await sentNcf("2026-11-05 09:00"); // Thursday
    const input = { receivedAt: at("2026-11-10 14:00"), files: [reply()], note: "" };
    await assert.rejects(pur.markReturned(users.qc, id, input), /role/);
    await assert.rejects(pur.markReturned(users.pur, id, { ...input, files: [] }), /Attach/);
    await assert.rejects(pur.markReturned(users.pur, id, { ...input, receivedAt: at("2026-11-04 09:00") }), /before the form was sent/);
    await assert.rejects(pur.markReturned(users.pur, id, { ...input, receivedAt: new Date(Date.now() + 3_600_000) }), /future/);
  });

  test("the clock stops at the received time, not when Purchasing clicks; the reply is kept as received", async () => {
    const r = await pur.markReturned(users.pur, id, { receivedAt: at("2026-11-10 14:00"), files: [reply()], note: "Balasan email Hendra" }, at("2026-11-13 09:00"));
    // Thu 05/11 → Tue 10/11: Fri, Mon, Tue = 3 working days (the later click on Friday 13/11 does not count).
    assert.equal(r.workingDays, 3);
    const d = await ncf.getNcf(users.pur, id);
    assert.equal(d.status, "RESPONDED");
    assert.equal(d.request!.response_working_days, 3);
    assert.equal(d.capa!.received_via, "PURCHASING");
    assert.equal(d.capa!.root_cause, null, "no CAPA is re-typed or read automatically");
    assert.ok(d.evidence.some((e) => e.file_name === "reply.eml" && e.capa_response_id), "reply file kept");
    assert.ok(d.evidence.some((e) => e.caption === "Balasan email Hendra"), "note kept");
    await assert.rejects(pur.markReturned(users.pur, id, { receivedAt: at("2026-11-11 09:00"), files: [reply()], note: "" }), /waiting for the supplier/);
  });

  test("closing takes no verification note", async () => {
    await ncf.close(users.pur, id);
    assert.equal((await ncf.getNcf(users.pur, id)).status, "CLOSED");
  });

  test("the Supplier Outbox lists contacts and the running clock, one page at a time", async () => {
    const a = await sentNcf("2026-11-11 09:00");
    const b = await sentNcf("2026-11-11 10:00");
    const { rows, total } = await pur.listDispatch(users.pur, "waiting", 1, 1);
    assert.equal(total, 2);
    assert.equal(rows.length, 1, "page size is respected");
    assert.equal(rows[0].id, a, "oldest sent first");
    assert.equal(rows[0].running, true);
    assert.ok(rows[0].contacts.some((c) => c.email === "qa@premier.demo"));
    assert.equal((await pur.listDispatch(users.pur, "waiting", 2, 1)).rows[0].id, b);
    await assert.rejects(pur.listDispatch(users.qc, "waiting"), /role/);
  });
});

describe("Reports and export", () => {
  test("dashboard counts replies and waits; export has an NCF sheet and an Items sheet; roles are enforced", async () => {
    const rep = await import("../src/lib/reports.ts");
    const period = { from: "2026-01-01", to: "2026-12-31" };
    const d = await rep.dashboard(users.qcm, period);
    const sent = await q<{ n: number }>(pool, "select count(*)::int as n from ncf where status = 'SENT'");
    const replied = await q<{ n: number }>(pool, "select count(*)::int as n from supplier_request where responded_at is not null");
    assert.equal(d.kpi.waiting, sent[0].n);
    assert.equal(d.kpi.responded, replied[0].n);
    assert.ok(d.suppliers.length > 0 && d.monthly.length > 0);

    await assert.rejects(rep.exportXlsx(users.pur, period), /role/);
    const x = await rep.exportXlsx(users.qcm, period);
    const submitted = await q<{ n: number }>(pool, "select count(*)::int as n from ncf where status <> 'DRAFT'");
    assert.equal(x.ncfs, submitted[0].n, "approvers export every submitted NCF, not drafts");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(x.buffer).buffer);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["NCF", "Items"]);
    assert.equal(wb.getWorksheet("NCF")!.rowCount - 1, x.ncfs);
    await assert.rejects(rep.dashboard(users.qc, { from: "2026-12-31", to: "2026-01-01" }), /starts after it ends/);
  });
});

describe("Supplier Master", () => {
  test("Purchasing, PCH and Super Admin manage suppliers and contacts; QC cannot; every change is audited", async () => {
    const sup = await import("../src/lib/suppliers.ts");
    await assert.rejects(sup.listSuppliers(users.qc, ""), /role/);
    await assert.rejects(sup.createSupplier(users.qc, { code: "VLP09999", name: "Uji Coba, PT" }), /role/);
    const { rows, total } = await sup.listSuppliers(users.pur, "VLP", 1, 10);
    assert.ok(total >= 2 && rows.every((r) => r.code.startsWith("VLP")));

    const id = await sup.createSupplier(users.pch, { code: " vlp09999 ", name: "Uji Coba, PT" });
    await assert.rejects(sup.createSupplier(users.admin, { code: "VLP09999", name: "Lain, PT" }), /already exists/);
    await assert.rejects(sup.createSupplier(users.pur, { code: "a b", name: "X, PT" }), /Vendor code/);
    await assert.rejects(sup.saveContact(users.pur, { id: null, supplierId: id, name: "Tanpa Kontak", email: "", phone: "", active: true, ncf: true }), /email or a phone/);
    const c = await sup.saveContact(users.pur, { id: null, supplierId: id, name: "Rina (QA)", email: "QA@ujicoba.demo", phone: "", active: true, ncf: true });
    await sup.saveContact(users.pur, { id: c, supplierId: id, name: "Rina (QA)", email: "qa@ujicoba.demo", phone: "0812", active: false, ncf: true });
    await sup.renameSupplier(users.pur, id, "Uji Coba Sejahtera, PT");

    const s = await sup.getSupplier(users.pur, id);
    assert.equal(s.code, "VLP09999");
    assert.equal(s.name, "Uji Coba Sejahtera, PT");
    assert.deepEqual(s.contacts.map((x) => [x.email, x.active]), [["qa@ujicoba.demo", false]]);
    const log = await q<{ action: string }>(pool, "select action from audit_log where entity = 'supplier' and entity_id = $1 order by id", [id]);
    assert.deepEqual(log.map((l) => l.action), ["CREATE_SUPPLIER", "ADD_CONTACT", "EDIT_CONTACT", "RENAME_SUPPLIER"]);

    // The NCF history shows only the stages the department works with: Purchasing never sees drafts.
    const premier = (await one<{ id: number }>(pool, "select id from supplier where sap_vendor_code = 'VLP00412'"))!.id;
    const hist = await sup.getSupplier(users.pur, premier);
    assert.ok(hist.ncfs.length > 0 && hist.ncfs.every((n) => !["DRAFT", "WAITING_APPROVAL"].includes(n.status)));
  });
});
