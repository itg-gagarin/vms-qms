import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { at, rebuildDb } from "./helpers.mts";

const { pool, one } = await import("../src/lib/db.ts");
const { loadActor, workingDaysBetween } = await import("../src/lib/core.ts");
const adm = await import("../src/lib/admin.ts");
const ncf = await import("../src/lib/ncf.ts");

type Actor = NonNullable<Awaited<ReturnType<typeof loadActor>>>;
const users: Record<string, Actor> = {};
const id = async (email: string) => (await one<{ id: number }>(pool, "select id from app_user where email = $1", [email]))!.id;

before(async () => {
  rebuildDb();
  for (const l of ["qc", "qcm", "whs", "gm", "admin"]) users[l] = (await loadActor(pool, await id(`${l}@demo.local`)))!;
});
after(async () => pool.end());

describe("Super Admin settings", () => {
  test("only Super Admin manages accounts; emails are unique; passwords need 8 characters", async () => {
    await assert.rejects(adm.createUser(users.qcm, { name: "X", position: "", email: "x@demo.local", password: "longenough" }), /role/);
    await assert.rejects(adm.createUser(users.admin, { name: "X", position: "", email: "qc@demo.local", password: "longenough" }), /exists/);
    await assert.rejects(adm.createUser(users.admin, { name: "X", position: "", email: "new@demo.local", password: "short" }), /8 characters/);
    const nu = await adm.createUser(users.admin, { name: "Nadia", position: "QC Incoming", email: "Nadia@Demo.local", password: "firstpass1" });
    const bu = (await one<{ id: number }>(pool, "select id from business_unit where code = 'BU-DEMO'"))!.id;
    await adm.addRole(users.admin, nu, "QC_INSPECTOR", bu, null);
    await assert.rejects(adm.addRole(users.admin, nu, "QC_INSPECTOR", bu, null), /already/);
    const nadia = (await loadActor(pool, nu))!;
    assert.equal(nadia.email, "nadia@demo.local");
    assert.deepEqual(nadia.roles, [{ role: "QC_INSPECTOR", bu_id: bu }]);
  });

  test("guardrails: no self-deactivation, at least one Super Admin, chain approvers stay until replaced", async () => {
    await assert.rejects(adm.setActive(users.admin, users.admin.id, false), /your own/);
    const adminRole = (await one<{ id: number }>(pool, "select id from user_role where user_id = $1 and role = 'SUPER_ADMIN'", [users.admin.id]))!.id;
    await assert.rejects(adm.removeRole(users.admin, adminRole), /at least one active Super Admin/);
    await assert.rejects(adm.setActive(users.admin, users.whs.id, false), /approval chain/);
    const log = await one<{ n: number }>(pool, "select count(*)::int as n from audit_log where entity = 'app_user'");
    assert.ok(log!.n >= 2, "account changes are audited");
  });

  test("approval chain: titled steps with named approvers who hold the approver role, no one twice", async () => {
    const bu = (await one<{ id: number }>(pool, "select id from business_unit where code = 'BU-DEMO'"))!.id;
    const step = (title: string, who: Actor | null) => ({ title, approverId: who?.id ?? null });
    await assert.rejects(adm.saveChain(users.admin, bu, [step("QC Manager", users.qcm), step("GM", users.qcm), step("", null)]), /two steps/);
    await assert.rejects(adm.saveChain(users.admin, bu, [step("QC Manager", users.qc), step("", null), step("", null)]), /Approver role/);
    await adm.saveChain(users.admin, bu, [step("QC Manager", users.qcm), step("GM", users.gm), step("", null)]);
    const steps = await adm.approvalChains();
    assert.deepEqual(steps.filter((s) => s.bu_id === bu).map((s) => s.approver_title), ["QC Manager", "GM"]);
    await adm.setActive(users.admin, users.whs.id, false); // no longer on the chain
  });

  test("numbering: format is checked, the counter only moves forward, new NCFs follow it", async () => {
    await assert.rejects(adm.saveNumbering(users.admin, { format: "NCF-{ROMAN}", reset: "yearly" }, null), /\{SEQ\}/);
    await assert.rejects(adm.saveNumbering(users.admin, { format: "NCF-{SEQ:4}", reset: "yearly" }, null), /year/);
    await assert.rejects(adm.saveNumbering(users.admin, { format: "{SEQ}/{FOO}/{YYYY}", reset: "yearly" }, null), /Unknown part/);
    await adm.saveNumbering(users.admin, { format: "NCF/{BU}/{YY}{MM}/{SEQ:4}", reset: "yearly" }, null, at("2026-11-13 09:00"));
    await assert.rejects(adm.saveNumbering(users.admin, { format: "NCF/{BU}/{YY}{MM}/{SEQ:4}", reset: "yearly" }, 400, at("2026-11-13 09:00")), /already used/);
    await adm.saveNumbering(users.admin, { format: "NCF/{BU}/{YY}{MM}/{SEQ:4}", reset: "yearly" }, 500, at("2026-11-13 09:00"));
    const mr = (await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = '260014212'"))!.id;
    const n = await ncf.createDraft(users.qc, mr, at("2026-11-13 09:30"));
    assert.equal((await ncf.getNcf(users.qc, n)).ncf_no, "NCF/BU-DEMO/2611/0500");
  });

  test("a public holiday stops counting as a working day", async () => {
    const before = await workingDaysBetween(pool, at("2026-12-23 09:00"), at("2026-12-28 09:00"));
    await adm.setHoliday(users.admin, "2026-12-25", "Hari Raya Natal", true);
    assert.equal(await workingDaysBetween(pool, at("2026-12-23 09:00"), at("2026-12-28 09:00")), before - 1);
    await assert.rejects(adm.setHoliday(users.admin, "2026-12-26", "Sabtu", true), /Weekends/);
    await adm.setHoliday(users.admin, "2026-12-25", "", false);
    assert.equal(await workingDaysBetween(pool, at("2026-12-23 09:00"), at("2026-12-28 09:00")), before);
  });
});
