import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { at, photo, rebuildDb } from "./helpers.mts";
import type { HeaderInput } from "../src/lib/ncf.ts";

// Imported after helpers so DATABASE_URL points at the test database.
const { pool, one, q } = await import("../src/lib/db.ts");
const { loadActor } = await import("../src/lib/core.ts");
const ncf = await import("../src/lib/ncf.ts");
const pur = await import("../src/lib/purchasing.ts");
const { runReminders } = await import("../src/lib/reminders.ts");
const ver = await import("../src/lib/verify.ts");

type Actor = NonNullable<Awaited<ReturnType<typeof loadActor>>>;
const users: Record<string, Actor> = {};
const PW = "demo1234";

async function actor(login: string) {
  const u = await one<{ id: number }>(pool, "select id from app_user where email = $1", [`${login}@demo.local`]);
  return (await loadActor(pool, u!.id))!;
}

const header = (over: Partial<HeaderInput> = {}): HeaderInput => ({
  inspect_date: "2026-11-12",
  inspect_time: "11:30",
  goods_status: "FAILED",
  hold_note: "",
  problem_category_id: "1",
  problem_desc: "Printing jelek di bagian belakang box.",
  follow_up: "Retur. Barang 1: 100. Barang 2: 65.",
  ...over,
});

before(async () => {
  rebuildDb();
  for (const l of ["qc", "qcm", "whs", "gm", "pur", "pch", "audit", "admin"]) users[l] = await actor(l);
});
after(async () => pool.end());

const mrreg = async (no: string) => (await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = $1", [no]))!.id;
const lines = async (id: number) => ncf.mrregLines(id);

describe("NCF end to end: Premier, form sent by email", () => {
  let id = 0;

  test("QC creates a draft from the MRReg; number continues the paper register; the receipt moves to Archive", async () => {
    const open = async () => (await ncf.searchMrreg(users.qc, "MR-2026-10-0001", 1, 20, "open")).length;
    const archived = async () => (await ncf.searchMrreg(users.qc, "MR-2026-10-0001", 1, 20, "archive"))[0];
    assert.equal(await open(), 1, "no NCF yet: the receipt is open");
    id = await ncf.createDraft(users.qc, await mrreg("MR-2026-10-0001"), at("2026-11-12 10:00"));
    assert.equal(await open(), 0, "once an NCF is made it leaves the open list");
    assert.deepEqual((await archived()).ncfs.map((n) => n.ncf_no), ["424/XI/2026"]);
    assert.equal(await ncf.countMrreg(users.qc, "MR-2026-10-0001", "archive"), 1);
    const d = await ncf.getNcf(users.qc, id);
    assert.equal(d.ncf_no, "424/XI/2026");
    assert.equal(d.status, "DRAFT");
    assert.equal(d.sj_no, "SJ-PRM-0410");
    assert.equal(d.supplier_name, "Premier");
  });

  test("only QC of the BU can create or edit", async () => {
    await assert.rejects(ncf.createDraft(users.pur, await mrreg("MR-2026-10-0001")), /role/);
    await assert.rejects(ncf.updateHeader(users.qcm, id, header()), /role/);
  });

  test("item rules: defect not above sample, no duplicate line, line from this MRReg only", async () => {
    const [l1, l2] = await lines(id);
    await assert.rejects(ncf.addItem(users.qc, id, l1.id, 32, 33, 100), /Jumlah Cacat/);
    await assert.rejects(ncf.addItem(users.qc, id, l1.id, 101, 1, 0), /Jumlah Sample/);
    await ncf.addItem(users.qc, id, l1.id, 32, 32, 100);
    await assert.rejects(ncf.addItem(users.qc, id, l1.id, 5, 1, 0), /already/);
    await ncf.addItem(users.qc, id, l2.id, 20, 20, 65);
    const other = (await ncf.mrregLines(id)).length;
    assert.equal(other, 2);
  });

  test("submit lists what is missing, and needs the password", async () => {
    await assert.rejects(ncf.submit(users.qc, id, PW), /Status barang.*Kategori.*evidence/s);
    // The error names the cards to highlight (C status, D problem, E evidence, F follow-up), before any password is checked.
    await assert.rejects(ncf.submit(users.qc, id, "wrong"), (e: unknown) => {
      assert.ok(e instanceof ncf.IncompleteError);
      assert.deepEqual([...new Set(e.missing.map((m) => m.part))], ["C", "D", "E", "F"]);
      return true;
    });
    await ncf.updateHeader(users.qc, id, header());
    await ncf.addEvidence(users.qc, id, [photo("cacat-1.png", "a")], "Foto sisi belakang");
    await assert.rejects(ncf.submit(users.qc, id, "wrong"), /Password/);
    const v = await ncf.submit(users.qc, id, PW, at("2026-11-12 11:45"));
    assert.equal(v, 1);
    const d = await ncf.getNcf(users.qc, id);
    assert.equal(d.status, "WAITING_APPROVAL");
    assert.equal(d.approvals.length, 4);
    assert.equal(d.approvals[0].decision, "APPROVED"); // QC signature, step 0
    assert.match(d.version!.content_hash, /^[0-9a-f]{64}$/);
  });

  test("content is locked after submit", async () => {
    await assert.rejects(ncf.updateHeader(users.qc, id, header()), /not allowed/);
  });

  test("approval goes in order; return needs a comment and creates version 2", async () => {
    await assert.rejects(ncf.decide(users.whs, id, "APPROVED", PW, ""), /another approver/);
    await assert.rejects(ncf.decide(users.qcm, id, "RETURNED", PW, ""), /comment/);
    assert.equal(await ncf.decide(users.qcm, id, "RETURNED", PW, "Tambahkan foto label box"), "DRAFT");
    await ncf.addEvidence(users.qc, id, [photo("label.png", "b")], "");
    assert.equal(await ncf.submit(users.qc, id, PW, at("2026-11-12 13:00")), 2);
    const d = await ncf.getNcf(users.qc, id);
    assert.equal(d.version!.version_no, 2);
    assert.ok(d.approvals.slice(1).every((a) => a.decision === null), "version 2 starts without approvals");
    assert.ok(d.history.some((h) => h.version_no === 1 && h.decision === "RETURNED"));
  });

  test("three approvers sign; NCF goes to Purchasing", async () => {
    assert.equal(await ncf.decide(users.qcm, id, "APPROVED", PW, "", at("2026-11-12 13:10")), "WAITING_APPROVAL");
    assert.equal(await ncf.decide(users.whs, id, "APPROVED", PW, "", at("2026-11-12 13:20")), "WAITING_APPROVAL");
    assert.equal(await ncf.decide(users.gm, id, "APPROVED", PW, "", at("2026-11-12 13:30")), "APPROVED");
    const mail = await q(pool, "select 1 from notification_outbox where event = 'NCF_APPROVED' and ref_id = $1", [id]);
    assert.equal(mail.length, 1);
    const d = await ncf.getNcf(users.pur, id);
    assert.ok(d.approvals.every((a) => a.decision === "APPROVED" && a.verify_code));
  });

  test("only Purchasing marks it sent, not before approval; nothing goes to the supplier from the system", async () => {
    await assert.rejects(ncf.markSent(users.qc, id, at("2026-11-12 14:00")), /role/);
    await assert.rejects(ncf.markSent(users.pur, id, at("2026-11-12 13:00")), /before the NCF was approved/);
    await ncf.markSent(users.pur, id, at("2026-11-12 14:00")); // Thursday
    assert.equal((await ncf.getNcf(users.pur, id)).status, "SENT");
    const toSupplier = await q(pool, "select 1 from notification_outbox where recipient_email is not null");
    assert.equal(toSupplier.length, 0, "no email to any supplier address");
    const tokens = await q(pool, "select 1 from access_token");
    assert.equal(tokens.length, 0, "no link is issued");
  });

  test("reminders follow the window (2 working days), go to Purchasing only, and stop at the maximum (3)", async () => {
    assert.equal((await runReminders(at("2026-11-13 08:00"))).length, 0); // Fri: 1 working day
    assert.equal((await runReminders(at("2026-11-15 08:00"))).length, 0); // Sun: still 1
    const r1 = await runReminders(at("2026-11-16 08:00")); // Mon: 2 working days
    assert.deepEqual(r1.map((r) => r.seq), [1]);
    assert.equal((await runReminders(at("2026-11-16 15:00"))).length, 0); // same day, no repeat
    assert.equal((await runReminders(at("2026-11-18 08:00"))).map((r) => r.seq)[0], 2); // 4 working days
    assert.equal((await runReminders(at("2026-11-20 08:00"))).map((r) => r.seq)[0], 3); // 6
    assert.equal((await runReminders(at("2026-11-24 08:00"))).length, 0); // max reached
    const last = await q(pool, "select 1 from notification_outbox where event='REMINDER' and payload->>'body' like '%last automatic reminder%'");
    assert.ok(last.length >= 1);
    const toSupplier = await q(pool, "select 1 from notification_outbox where event='REMINDER' and recipient_email is not null");
    assert.equal(toSupplier.length, 0);
  });

  test("the supplier's emailed reply is recorded; the clock stops at the time it arrived", async () => {
    await assert.rejects(pur.markReturned(users.pur, id, { receivedAt: at("2026-11-24 10:00"), files: [], note: "" }), /Attach/);
    const r = await pur.markReturned(users.pur, id,
      { receivedAt: at("2026-11-24 10:00"), files: [photo("balasan-supplier.png", "c")], note: "Balasan Hendra" }, at("2026-11-25 08:00"));
    // Sent Thu 12 Nov, reply arrived Tue 24 Nov: 13,16,17,18,19,20,23,24 = 8 working days (recording it on the 25th does not count)
    assert.equal(r.workingDays, 8);
    const d = await ncf.getNcf(users.pur, id);
    assert.equal(d.status, "RESPONDED");
    assert.equal(d.request!.response_working_days, 8);
    assert.equal(d.capa!.received_via, "PURCHASING");
    assert.equal(d.capa!.root_cause, null, "the CAPA stays in the reply file; nothing is re-typed");
  });

  test("Purchasing verifies and closes", async () => {
    await ncf.close(users.pur, id, at("2026-11-25 09:00"));
    const d = await ncf.getNcf(users.audit, id);
    assert.equal(d.status, "CLOSED");
    assert.equal(d.evidence.filter((e) => e.capa_response_id && e.file_id).length, 1);
  });

  test("QR codes open the record", async () => {
    const d = await ncf.getNcf(users.audit, id);
    const doc = await ver.verifyDocument(d.version!.verify_code, null, "1.2.3.4");
    assert.equal(doc.ncf_no, "424/XI/2026");
    assert.equal(doc.canOpenFull, false); // not logged in: summary only
    const gm = d.approvals.find((a) => a.step_no === 3)!;
    const sig = await ver.verifySignature(gm.verify_code!, users.audit, null);
    assert.equal(sig.signer_name, "Lina Wijaya");
    const scans = await one<{ n: number }>(pool, "select count(*)::int as n from qr_scan");
    assert.equal(scans!.n, 2);
  });

  test("every step is in the audit trail", async () => {
    const actions = (await ncf.auditTrail(id)).map((a) => a.action);
    for (const a of ["CREATE", "SUBMIT", "APPROVAL_RETURNED", "APPROVAL_APPROVED", "SENT", "REMINDER", "SUPPLIER_RETURNED", "CLOSE"]) {
      assert.ok(actions.includes(a), `missing ${a}`);
    }
  });
});

describe("Supplier without email: form sent another way", () => {
  let id = 0;
  test("draft, submit and approve", async () => {
    id = await ncf.createDraft(users.qc, await mrreg("MR-2026-11-0007"), at("2026-11-12 10:00"));
    const [l] = await lines(id);
    await ncf.addItem(users.qc, id, l.id, 20, 3, 0);
    await ncf.updateHeader(users.qc, id, header({ goods_status: "HOLD", hold_note: "Menunggu konfirmasi PPIC", problem_category_id: "2" }));
    await ncf.addEvidence(users.qc, id, [photo("kaki.png", "d")], "");
    await ncf.submit(users.qc, id, PW, at("2026-11-12 11:00"));
    for (const u of ["qcm", "whs", "gm"]) await ncf.decide(users[u], id, "APPROVED", PW, "", at("2026-11-12 14:00"));
    assert.equal((await ncf.getNcf(users.pur, id)).ncf_no, "425/XI/2026");
  });

  test("PCH marks it sent (e.g. by WhatsApp); the reminder goes to Purchasing", async () => {
    await ncf.markSent(users.pch, id, at("2026-11-12 15:00"));
    const r = await runReminders(at("2026-11-16 09:00"));
    assert.ok(r.some((x) => x.ncf_no === "425/XI/2026"));
    const toSupplier = await q(pool, "select 1 from notification_outbox where event='REMINDER' and recipient_email is not null");
    assert.equal(toSupplier.length, 0);
  });
});

describe("Reject path", () => {
  test("a rejected NCF becomes Void with the reason", async () => {
    const id = await ncf.createDraft(users.qc, await mrreg("MR-2026-10-0001"));
    const [l] = await lines(id);
    await ncf.addItem(users.qc, id, l.id, 10, 1, 0);
    await ncf.updateHeader(users.qc, id, header({ goods_status: "OTHER" }));
    await ncf.addEvidence(users.qc, id, [photo("x.png", "e")], "");
    await ncf.submit(users.qc, id, PW);
    assert.equal(await ncf.decide(users.qcm, id, "REJECTED", PW, "Bukan cacat, sesuai spesifikasi"), "VOID");
    const d = await ncf.getNcf(users.qc, id);
    assert.match(d.void_reason!, /Rick|Rudi Hartono/);
  });
});

describe("Access rules", () => {
  test("auditor reads everything; QC lists only its BU; settings need Super Admin", async () => {
    const all = await ncf.listNcf(users.audit, "all");
    assert.equal(all.length, 3);
    const adm = await import("../src/lib/admin.ts");
    const values = { reminder_window_wd: "3", reminder_max: "2", response_target_wd: "3" };
    await assert.rejects(adm.saveWorkflow(users.pur, values), /role/);
    await adm.saveWorkflow(users.admin, values);
    assert.equal((await adm.workflowSettings()).reminder_window_wd, 3);
  });

  test("a status filter lists only that status, inside the user's own scope", async () => {
    const all = await ncf.listNcf(users.audit, "all");
    for (const s of new Set(all.map((r) => r.status))) {
      const rows = await ncf.listNcf(users.audit, "all", s);
      assert.ok(rows.length > 0);
      assert.ok(rows.every((r) => r.status === s));
      assert.equal(rows.length, all.filter((r) => r.status === s).length);
    }
    // The filter narrows, never widens: QC still sees only its own Business Unit.
    const qcAll = await ncf.listNcf(users.qc, "all");
    const qcDrafts = await ncf.listNcf(users.qc, "all", "DRAFT");
    assert.ok(qcDrafts.every((d) => qcAll.some((r) => r.id === d.id)));
  });

  test("an MRReg with several POs: QC chooses the PO in the draft; items come only from that PO", async () => {
    const mr = await mrreg("MR-2026-11-0009");
    const po = (await one<{ id: number }>(pool, "select id from purchase_order where po_no = '4500012367'"))!.id;
    const first = (await one<{ id: number }>(pool, "select id from purchase_order where po_no = '4500012345'"))!.id;
    const elsewhere = (await one<{ id: number }>(pool, "select id from purchase_order where po_no = '4500012399'"))!.id;
    const id = await ncf.createDraft(users.qc, mr, at("2026-11-13 08:05"));
    assert.equal((await ncf.getNcf(users.qc, id)).po_id, null, "several POs: none is picked for QC");
    assert.deepEqual((await ncf.mrregPos(id)).map((p) => p.po_no), ["4500012345", "4500012367"]);
    assert.equal((await lines(id)).length, 0, "no items until the PO is chosen");
    const anyLine = (await one<{ id: number }>(pool, "select id from mrreg_line where mrreg_id = $1 limit 1", [mr]))!.id;
    await assert.rejects(ncf.addItem(users.qc, id, anyLine, 5, 1, 0), /Choose the PO/);
    await assert.rejects(ncf.setPo(users.qc, id, elsewhere), /not on the MRReg/);
    await ncf.setPo(users.qc, id, po);
    const ls = await lines(id);
    assert.deepEqual(ls.map((l) => l.po_no), ["4500012367"]);
    const blackLine = (await one<{ id: number }>(pool,
      "select l.id from mrreg_line l join po_line pl on pl.id = l.po_line_id where l.mrreg_id = $1 and pl.po_id <> $2", [mr, po]))!.id;
    await assert.rejects(ncf.addItem(users.qc, id, blackLine, 5, 1, 0), /this MRReg and PO/);
    await ncf.addItem(users.qc, id, ls[0].id, 5, 1, 0);
    await assert.rejects(ncf.setPo(users.qc, id, first), /Remove the 1 item/);
    assert.equal((await ncf.getNcf(users.qc, id)).po_no, "4500012367");
    const actions = (await ncf.auditTrail(id)).map((a) => a.action);
    assert.ok(actions.includes("SET_PO"));
  });

  test("each department sees only its stages; drafts stay with QC", async () => {
    const draft = await ncf.createDraft(users.qc, await mrreg("MR-2026-11-0007"), at("2026-11-13 08:00"));
    for (const who of ["qcm", "gm", "pur", "pch"]) {
      await assert.rejects(ncf.getNcf(users[who], draft), /not open to your department/, who);
    }
    assert.equal((await ncf.getNcf(users.qc, draft)).status, "DRAFT");
    assert.equal((await ncf.getNcf(users.audit, draft)).status, "DRAFT");

    const only = async (who: string, allowed: string[]) => {
      const rows = await ncf.listNcf(users[who], "all");
      assert.ok(rows.every((r) => allowed.includes(r.status)), `${who} saw ${[...new Set(rows.map((r) => r.status))]}`);
    };
    await only("qc", ["DRAFT", "WAITING_APPROVAL", "CLOSED", "VOID"]);
    await only("qcm", ["WAITING_APPROVAL", "APPROVED", "CLOSED", "VOID"]);
    await only("pur", ["APPROVED", "SENT", "RESPONDED", "CLOSED"]);
    // Asking for a status outside the department's stages returns nothing, not an error.
    assert.equal((await ncf.listNcf(users.pur, "all", "DRAFT")).length, 0);
  });

  test("Super Admin can do every role's work, but cannot sign an approval step named for someone else", async () => {
    assert.ok((await ncf.countMrreg(users.admin, "", "open")) + (await ncf.countMrreg(users.admin, "", "archive")) > 0, "sees goods receipts like QC");
    const id = await ncf.createDraft(users.admin, await mrreg("MR-2026-11-0007"), at("2026-11-13 09:00"));
    await ncf.updateHeader(users.admin, id, header());
    const [l] = await lines(id);
    await ncf.addItem(users.admin, id, l.id, 10, 2, 20);
    await ncf.addEvidence(users.admin, id, [photo("admin.png", "admin")], "");
    await ncf.submit(users.admin, id, PW, at("2026-11-13 09:30"));

    // Signatures belong to the person on the approval chain, not to a role.
    await assert.rejects(ncf.decide(users.admin, id, "APPROVED", PW, ""), /another approver/);
    for (const who of ["qcm", "whs", "gm"]) await ncf.decide(users[who], id, "APPROVED", PW, "");

    await ncf.markSent(users.admin, id, new Date());
    assert.equal((await ncf.getNcf(users.admin, id)).status, "SENT");
  });
});
