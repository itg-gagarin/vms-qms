import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { at, photo, rebuildDb } from "./helpers.mts";

const { pool, one, q } = await import("../src/lib/db.ts");
const { loadActor } = await import("../src/lib/core.ts");
const ncf = await import("../src/lib/ncf.ts");
const sup = await import("../src/lib/supplier.ts");
const pur = await import("../src/lib/purchasing.ts");
const { ExtractionError } = await import("../src/lib/extract.ts");

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

/** An NCF sent to the supplier by link at `sentAt` (WIB). */
async function sentNcf(sentAt: string) {
  const mr = (await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = 'MR-2026-10-0001'"))!.id;
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
  const { link } = await ncf.send(users.pur, id, "LINK", at(sentAt));
  return { id, token: link.split("/s/")[1] };
}

const reply = () => new File([Buffer.from("Dear Integra, root cause: ink ran out on the night shift.")], "reply.eml", { type: "message/rfc822" });

const fakeExtractor = async () => ({
  model: "test-model",
  skipped: [],
  fields: {
    root_cause: "Tinta habis pada shift malam.",
    corrective_action: "Cetak ulang dan kirim pengganti.",
    target_date: "2026-11-20",
    preventive_action: "Cek tinta tiap awal shift.",
    effective_from: "next week", // not a date: must be left for Purchasing to fill
    responder_name: "Hendra",
    responder_position: "QA Manager",
    responder_email: "",
    notes: "Effective date was not given as a date.",
  },
});

describe("Purchasing records an emailed reply (Returned)", () => {
  let id = 0;

  test("only Purchasing can mark returned; the reply must be attached and not predate the link", async () => {
    ({ id } = await sentNcf("2026-11-05 09:00")); // Thursday
    const input = { receivedAt: at("2026-11-10 14:00"), files: [reply()], note: "" };
    await assert.rejects(pur.markReturned(users.qc, id, input, { extractor: fakeExtractor }), /role/);
    await assert.rejects(pur.markReturned(users.pur, id, { ...input, files: [] }, { extractor: fakeExtractor }), /Attach/);
    await assert.rejects(pur.markReturned(users.pur, id, { ...input, receivedAt: at("2026-11-04 09:00") }, { extractor: fakeExtractor }), /before the link/);
  });

  test("the clock stops at the received time, not when Purchasing clicks", async () => {
    const r = await pur.markReturned(users.pur, id, { receivedAt: at("2026-11-10 14:00"), files: [reply()], note: "Balasan email Hendra" },
      { extractor: fakeExtractor, now: at("2026-11-13 09:00") });
    // Thu 05/11 → Tue 10/11: Fri, Mon, Tue = 3 working days (the later click on Friday 13/11 does not count).
    assert.equal(r.workingDays, 3);
    const d = await ncf.getNcf(users.pur, id);
    assert.equal(d.status, "RESPONDED");
    assert.equal(d.request!.response_working_days, 3);
    assert.equal(d.capa!.received_via, "PURCHASING");
    assert.equal(d.capa!.root_cause, "Tinta habis pada shift malam.");
    assert.equal(d.capa!.effective_from, null, "a non-date from the reading is not stored as a date");
    assert.equal(d.capa!.extraction!.model, "test-model");
    assert.ok(d.evidence.some((e) => e.file_name === "reply.eml" && e.capa_response_id), "reply file kept with the CAPA");
  });

  test("closing waits until Purchasing confirms the CAPA; every correction is logged", async () => {
    await assert.rejects(ncf.close(users.pur, id, "CAPA diterima."), /confirm the CAPA/);
    const fields = { root_cause: "Tinta habis pada shift malam.", corrective_action: "Cetak ulang 100 box.", target_date: "2026-11-20",
      preventive_action: "Cek tinta tiap awal shift.", effective_from: "", responder_name: "Hendra", responder_position: "QA Manager", responder_email: "" };
    await assert.rejects(pur.reviewCapa(users.pur, id, fields, true), /Berlaku mulai/);
    await pur.reviewCapa(users.pur, id, { ...fields, effective_from: "2026-11-16" }, true);
    const log = await q<{ field: string; old_value: string | null; new_value: string | null }>(pool,
      "select field, old_value, new_value from audit_log where entity = 'ncf' and entity_id = $1 and action = 'CAPA_EDIT' order by id", [id]);
    assert.deepEqual(log.map((l) => l.field), ["corrective_action", "effective_from"]);
    assert.equal(log[0].old_value, "Cetak ulang dan kirim pengganti.");
    assert.equal(log[0].new_value, "Cetak ulang 100 box.");
    await ncf.close(users.pur, id, "CAPA diterima, box pengganti dicek.");
    assert.equal((await ncf.getNcf(users.pur, id)).status, "CLOSED");
  });

  test("when automatic reading fails the reply is still recorded, with empty fields to type in", async () => {
    const { id: id2 } = await sentNcf("2026-11-09 09:00");
    const failing = async () => { throw new ExtractionError("Automatic reading is busy right now."); };
    const r = await pur.markReturned(users.pch, id2, { receivedAt: at("2026-11-11 10:00"), files: [reply()], note: "" }, { extractor: failing });
    assert.equal(r.extracted, false);
    assert.match(r.extractionError!, /busy/);
    const d = await ncf.getNcf(users.pch, id2);
    assert.equal(d.status, "RESPONDED");
    assert.equal(d.capa!.root_cause, null);
    assert.match(d.capa!.extraction!.error!, /busy/);
  });

  test("a CAPA the supplier sent through the link stays as they wrote it", async () => {
    const { id: id3, token } = await sentNcf("2026-11-09 11:00");
    await sup.respond(token, {
      root_cause: "x", corrective_action: "y", target_date: "2099-01-01", preventive_action: "z", effective_from: "2026-11-12",
      responder_name: "A", responder_position: "B", responder_email: "a@b.co", confirm: true,
    }, [], {});
    await assert.rejects(pur.reviewCapa(users.pur, id3, { root_cause: "changed" }, false), /stays as they wrote it/);
    await ncf.close(users.pur, id3, "Diterima lewat link.");
  });

  test("the dispatch table lists the supplier's contacts and the running clock", async () => {
    const { id: id4 } = await sentNcf("2026-11-11 09:00");
    const rows = await pur.listDispatch(users.pur, "waiting");
    const row = rows.find((r) => r.id === id4)!;
    assert.equal(row.running, true);
    assert.ok(row.contacts.some((c) => c.email === "qa@premier.demo"));
    await assert.rejects(pur.listDispatch(users.qc, "waiting"), /role/);
  });
});
