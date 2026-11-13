import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { at, photo, rebuildDb } from "./helpers.mts";
import type { HeaderInput } from "../src/lib/ncf.ts";
import type { CapaInput } from "../src/lib/supplier.ts";

// Imported after helpers so DATABASE_URL points at the test database.
const { pool, one, q } = await import("../src/lib/db.ts");
const { loadActor } = await import("../src/lib/core.ts");
const ncf = await import("../src/lib/ncf.ts");
const sup = await import("../src/lib/supplier.ts");
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

const capa: CapaInput = {
  root_cause: "Tinta printer habis pada shift malam, QC akhir tidak memeriksa sisi belakang.",
  corrective_action: "Cetak ulang 165 box dan kirim pengganti.",
  target_date: "2026-11-25",
  preventive_action: "Checklist QC akhir menambah pemeriksaan sisi belakang.",
  effective_from: "2026-11-20",
  responder_name: "Hendra",
  responder_position: "QA Manager",
  responder_email: "hendra@premier.demo",
  confirm: true,
};

before(async () => {
  rebuildDb();
  for (const l of ["qc", "qcm", "whs", "gm", "pur", "pch", "audit", "admin"]) users[l] = await actor(l);
});
after(async () => pool.end());

const mrreg = async (no: string) => (await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = $1", [no]))!.id;
const lines = async (id: number) => ncf.mrregLines(id);

describe("NCF end to end: Premier, email", () => {
  let id = 0;
  let link = "";
  let token = "";

  test("QC creates a draft from the MRReg; number continues the paper register", async () => {
    id = await ncf.createDraft(users.qc, await mrreg("MR-2026-10-0001"), at("2026-11-12 10:00"));
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

  test("only Purchasing sends; email goes to the supplier contact", async () => {
    await assert.rejects(ncf.send(users.qc, id, "EMAIL"), /role/);
    const r = await ncf.send(users.pur, id, "EMAIL", at("2026-11-12 14:00")); // Thursday
    link = r.link;
    token = link.split("/s/")[1];
    const mail = await one<{ recipient_email: string }>(pool, "select recipient_email from notification_outbox where event = 'NCF_SENT' and ref_id = $1", [r.requestId]);
    assert.equal(mail!.recipient_email, "qa@premier.demo");
    assert.equal((await ncf.getNcf(users.pur, id)).status, "SENT");
  });

  test("reminders follow the window (2 working days) and stop at the maximum (3)", async () => {
    assert.equal((await sup.runReminders(at("2026-11-13 08:00"))).length, 0); // Fri: 1 working day
    assert.equal((await sup.runReminders(at("2026-11-15 08:00"))).length, 0); // Sun: still 1
    const r1 = await sup.runReminders(at("2026-11-16 08:00")); // Mon: 2 working days
    assert.deepEqual(r1.map((r) => r.seq), [1]);
    assert.equal(r1[0].toSupplier, true);
    assert.equal((await sup.runReminders(at("2026-11-16 15:00"))).length, 0); // same day, no repeat
    assert.equal((await sup.runReminders(at("2026-11-18 08:00"))).map((r) => r.seq)[0], 2); // 4 working days
    assert.equal((await sup.runReminders(at("2026-11-20 08:00"))).map((r) => r.seq)[0], 3); // 6
    assert.equal((await sup.runReminders(at("2026-11-24 08:00"))).length, 0); // max reached
    const last = await q(pool, "select 1 from notification_outbox where event='REMINDER' and payload->>'body' like '%last automatic reminder%'");
    assert.ok(last.length >= 1);
  });

  test("supplier opens the link, must fill every field, then responds once", async () => {
    const opened = await sup.openForSupplier(token, at("2026-11-23 09:00"));
    assert.equal(opened.canRespond, true);
    assert.equal(opened.ncf.ncf_no, "424/XI/2026");
    await assert.rejects(sup.respond(token, { ...capa, root_cause: "" }, [], {}, at("2026-11-24 10:00")), /Akar masalah/);
    await assert.rejects(sup.respond(token, { ...capa, confirm: false }, [], {}, at("2026-11-24 10:00")), /tick/);
    const r = await sup.respond(token, capa, [photo("perbaikan.png", "c")], { ip: "127.0.0.1" }, at("2026-11-24 10:00"));
    // Sent Thu 12 Nov, answered Tue 24 Nov: 13,16,17,18,19,20,23,24 = 8 working days
    assert.equal(r.workingDays, 8);
    await assert.rejects(sup.respond(token, capa, [], {}, at("2026-11-24 11:00")), /already/);
    const d = await ncf.getNcf(users.pur, id);
    assert.equal(d.status, "RESPONDED");
    assert.equal(d.request!.response_working_days, 8);
    assert.ok(d.request!.first_opened_at);
  });

  test("Purchasing verifies and closes", async () => {
    await assert.rejects(ncf.close(users.pur, id, ""), /verification/);
    await ncf.close(users.pur, id, "CAPA diterima. Box pengganti dicek saat datang.", at("2026-11-25 09:00"));
    const d = await ncf.getNcf(users.audit, id);
    assert.equal(d.status, "CLOSED");
    assert.equal(d.capa!.responder_name, "Hendra");
    assert.equal(d.evidence.filter((e) => e.capa_response_id).length, 1);
  });

  test("QR codes open the record; a closed link cannot answer again", async () => {
    const d = await ncf.getNcf(users.audit, id);
    const doc = await ver.verifyDocument(d.version!.verify_code, null, "1.2.3.4");
    assert.equal(doc.ncf_no, "424/XI/2026");
    assert.equal(doc.canOpenFull, false); // not logged in: summary only
    const gm = d.approvals.find((a) => a.step_no === 3)!;
    const sig = await ver.verifySignature(gm.verify_code!, users.audit, null);
    assert.equal(sig.signer_name, "Lina Wijaya");
    const scans = await one<{ n: number }>(pool, "select count(*)::int as n from qr_scan");
    assert.equal(scans!.n, 2);
    const reopened = await sup.openForSupplier(token, at("2026-11-26 09:00"));
    assert.equal(reopened.canRespond, false);
  });

  test("every step is in the audit trail", async () => {
    const actions = (await ncf.auditTrail(id)).map((a) => a.action);
    for (const a of ["CREATE", "SUBMIT", "APPROVAL_RETURNED", "APPROVAL_APPROVED", "SEND", "REMINDER", "SUPPLIER_OPENED", "SUPPLIER_RESPONDED", "CLOSE"]) {
      assert.ok(actions.includes(a), `missing ${a}`);
    }
  });
});

describe("Supplier without email: link only", () => {
  let id = 0;
  test("draft, submit and approve", async () => {
    id = await ncf.createDraft(users.qc, await mrreg("MR-2026-11-0007"), at("2026-11-12 10:00"));
    const [l] = await lines(id);
    await ncf.addItem(users.qc, id, l.id, 20, 3, 0);
    await ncf.updateHeader(users.qc, id, header({ goods_status: "HOLD", hold_note: "Menunggu konfirmasi PPIC", problem_category_id: "2" }));
    await ncf.addEvidence(users.qc, id, [photo("kaki.png", "d")], "");
    await ncf.submit(users.qc, id, PW);
    for (const u of ["qcm", "whs", "gm"]) await ncf.decide(users[u], id, "APPROVED", PW, "");
    assert.equal((await ncf.getNcf(users.pur, id)).ncf_no, "425/XI/2026");
  });

  test("email send is refused; link works; reminder goes to Purchasing only", async () => {
    await assert.rejects(ncf.send(users.pur, id, "EMAIL"), /no email contact/);
    const { link } = await ncf.send(users.pch, id, "LINK", at("2026-11-12 15:00"));
    const r = await sup.runReminders(at("2026-11-16 09:00"));
    const mine = r.find((x) => x.ncf_no === "425/XI/2026")!;
    assert.equal(mine.toSupplier, false);
    const toSupplier = await q(pool, "select 1 from notification_outbox where event='REMINDER' and recipient_email is not null and payload->>'subject' like '%425/XI/2026%'");
    assert.equal(toSupplier.length, 0);
    const oldToken = link.split("/s/")[1];
    const newLink = await ncf.reissueLink(users.pur, id);
    await assert.rejects(sup.openForSupplier(oldToken), /replaced/);
    const ok = await sup.openForSupplier(newLink.split("/s/")[1]);
    assert.equal(ok.canRespond, true);
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
    const values = { reminder_window_wd: "3", reminder_max: "2", token_valid_days: "30", response_target_wd: "3" };
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

  test("an MRReg with several POs needs the PO first; items come only from that PO", async () => {
    const mr = await mrreg("MR-2026-11-0009");
    await assert.rejects(ncf.createDraft(users.qc, mr, at("2026-11-13 08:00")), /several POs/);
    const po = (await one<{ id: number }>(pool, "select id from purchase_order where po_no = '4500012367'"))!.id;
    const other = (await one<{ id: number }>(pool, "select id from purchase_order where po_no = '4500012399'"))!.id;
    await assert.rejects(ncf.createDraft(users.qc, mr, at("2026-11-13 08:00"), other), /not on the MRReg/);
    const id = await ncf.createDraft(users.qc, mr, at("2026-11-13 08:05"), po);
    const ls = await lines(id);
    assert.deepEqual(ls.map((l) => l.po_no), ["4500012367"]);
    const blackLine = (await one<{ id: number }>(pool,
      "select l.id from mrreg_line l join po_line pl on pl.id = l.po_line_id where l.mrreg_id = $1 and pl.po_id <> $2", [mr, po]))!.id;
    await assert.rejects(ncf.addItem(users.qc, id, blackLine, 5, 1, 0), /this MRReg and PO/);
    assert.equal((await ncf.getNcf(users.qc, id)).po_no, "4500012367");
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
    assert.ok((await ncf.searchMrreg(users.admin, "")).length > 0, "sees goods receipts like QC");
    const id = await ncf.createDraft(users.admin, await mrreg("MR-2026-11-0007"), at("2026-11-13 09:00"));
    await ncf.updateHeader(users.admin, id, header());
    const [l] = await lines(id);
    await ncf.addItem(users.admin, id, l.id, 10, 2, 20);
    await ncf.addEvidence(users.admin, id, [photo("admin.png", "admin")], "");
    await ncf.submit(users.admin, id, PW, at("2026-11-13 09:30"));

    // Signatures belong to the person on the approval chain, not to a role.
    await assert.rejects(ncf.decide(users.admin, id, "APPROVED", PW, ""), /another approver/);
    for (const who of ["qcm", "whs", "gm"]) await ncf.decide(users[who], id, "APPROVED", PW, "");

    await ncf.send(users.admin, id, "LINK", at("2026-11-13 10:00"));
    assert.equal((await ncf.getNcf(users.admin, id)).status, "SENT");
  });
});
