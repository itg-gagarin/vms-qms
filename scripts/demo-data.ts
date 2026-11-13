// Demo data for a test server: one NCF in every status, made through the real business rules, so signatures,
// versions, QR codes, the audit trail and the email outbox look exactly as they would in use.
// Never run this on a database with real records.
//
// Usage: npm run db:demo            (local, after db:migrate and db:seed)
//        DEMO_DATA=1 at container start (see Dockerfile)
// Safe to run again: it stops if the demo receipts already exist.
import { deflateSync, crc32 } from "node:zlib";
import type { PoolClient } from "pg";
import { loadActor as loadById } from "../src/lib/core.ts";
import { one, pool, tx } from "../src/lib/db.ts";
import * as ncf from "../src/lib/ncf.ts";
import * as sup from "../src/lib/supplier.ts";

const PW = process.env.SEED_PASSWORD ?? "demo1234";
const MARKER = "MR-2026-10-0102";

async function loadActor(email: string) {
  const u = await one<{ id: number }>(pool, "select id from app_user where email = $1", [email]);
  if (!u) throw new Error(`Demo user ${email} is missing: run db:seed first.`);
  return (await loadById(pool, u.id))!;
}

/** Runs fn unless the marker receipt exists. Refuses a production database unless DEMO_DATA=1. */
async function runOnce(marker: string, fn: () => Promise<void>) {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_DATA !== "1") {
    throw new Error("demo: refusing to run in production without DEMO_DATA=1");
  }
  if (await one(pool, "select 1 from mrreg where mrreg_no = $1", [marker])) {
    console.log("demo: already loaded, nothing to do");
    return;
  }
  await fn();
}

/** A moment in WIB, e.g. at("2026-10-15 09:10"). */
const at = (s: string) => new Date(s.replace(" ", "T") + ":00+07:00");

/** A plain striped PNG standing in for an inspection photo. */
function photo(name: string, rgb: [number, number, number]) {
  const w = 480, h = 320;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const k = ((x + y) >> 4) % 2 ? 1 : 0.85;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgb[0] * k; raw[o + 1] = rgb[1] * k; raw[o + 2] = rgb[2] * k;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  return new File([png], name, { type: "image/png" });
}

type Line = { item: string; desc: string; uom: string; qty: number; price: number };
type Receipt = { mrreg: string; po: string; supplier: string; sj: string; sjDate: string; received: string; lines: Line[] };

const SUPPLIERS = [
  { code: "V0003", name: "PT Mega Kemas Indonesia", contact: "QA Mega Kemas", email: "qa@megakemas.demo" },
  { code: "V0004", name: "PT Cahaya Hardware", contact: "Customer Service", email: "cs@cahayahw.demo" },
  { code: "V0005", name: "UD Rotan Abadi", contact: "Ibu Sari", email: "admin@rotanabadi.demo" },
];

const RECEIPTS: Receipt[] = [
  { mrreg: "MR-2026-10-0102", po: "4500012410", supplier: "V0003", sj: "SJ-MK-2210", sjDate: "2026-10-19", received: "2026-10-20",
    lines: [{ item: "PK.002.0001.0120.00060", desc: "Karton Box 5 Ply 120x60x40", uom: "PCS", qty: 500, price: 18500 }] },
  { mrreg: "MR-2026-10-0118", po: "4500012433", supplier: "V0004", sj: "SJ-CH-0927", sjDate: "2026-10-26", received: "2026-10-27",
    lines: [
      { item: "HW.004.0002.0035.00001", desc: "Engsel Sendok 35 mm Soft Close", uom: "PCS", qty: 2000, price: 6500 },
      { item: "HW.004.0007.0128.00002", desc: "Handle Aluminium 128 mm Black", uom: "PCS", qty: 1000, price: 12000 },
    ] },
  { mrreg: "MR-2026-11-0003", po: "4500012461", supplier: "V0005", sj: "SJ-RA-1103", sjDate: "2026-11-02", received: "2026-11-03",
    lines: [{ item: "RM.003.0005.0005.00010", desc: "Rotan Sintetis Pipih 5 mm Natural", uom: "ROLL", qty: 300, price: 95000 }] },
  { mrreg: "MR-2026-11-0011", po: "4500012478", supplier: "V0001", sj: "SJ-PRM-1108", sjDate: "2026-11-07", received: "2026-11-09",
    lines: [{ item: "RP.001.0008.0005.00419", desc: "", uom: "PCS", qty: 120, price: 185000 }] },
  { mrreg: "MR-2026-11-0014", po: "4500012482", supplier: "V0003", sj: "SJ-MK-2307", sjDate: "2026-11-09", received: "2026-11-10",
    lines: [{ item: "PK.002.0001.0120.00060", desc: "", uom: "PCS", qty: 800, price: 18500 }] },
  { mrreg: "MR-2026-11-0016", po: "4500012490", supplier: "V0004", sj: "SJ-CH-1010", sjDate: "2026-11-09", received: "2026-11-10",
    lines: [{ item: "HW.004.0007.0128.00002", desc: "", uom: "PCS", qty: 600, price: 12000 }] },
  { mrreg: "MR-2026-11-0019", po: "4500012497", supplier: "V0005", sj: "SJ-RA-1111", sjDate: "2026-11-11", received: "2026-11-12",
    lines: [{ item: "RM.003.0005.0005.00010", desc: "", uom: "ROLL", qty: 150, price: 95000 }] },
];

async function masterData(c: PoolClient) {
  const bu = (await one<{ id: number }>(c, "select id from business_unit where code = 'BU-DEMO'"))!.id;
  for (const s of SUPPLIERS) {
    const id = (await one<{ id: number }>(c, "insert into supplier(sap_vendor_code,name) values ($1,$2) returning id", [s.code, s.name]))!.id;
    await c.query("insert into supplier_contact(supplier_id,name,email) values ($1,$2,$3)", [id, s.contact, s.email]);
  }
  for (const r of RECEIPTS) {
    const supplier = (await one<{ id: number }>(c, "select id from supplier where sap_vendor_code = $1", [r.supplier]))!.id;
    const po = (await one<{ id: number }>(c,
      "insert into purchase_order(po_no,supplier_id,po_date,currency,synced_at) values ($1,$2,$3::date - 21,'IDR',now()) returning id",
      [r.po, supplier, r.received]))!.id;
    const mr = (await one<{ id: number }>(c,
      "insert into mrreg(mrreg_no,bu_id,supplier_id,sj_no,sj_date,receipt_date,synced_at) values ($1,$2,$3,$4,$5,$6,now()) returning id",
      [r.mrreg, bu, supplier, r.sj, r.sjDate, r.received]))!.id;
    let n = 0;
    for (const l of r.lines) {
      n++;
      let item = (await one<{ id: number }>(c, "select id from item where sap_material_code = $1", [l.item]))?.id;
      item ??= (await one<{ id: number }>(c, "insert into item(sap_material_code,description,uom) values ($1,$2,$3) returning id",
        [l.item, l.desc, l.uom]))!.id;
      const pl = (await one<{ id: number }>(c,
        `insert into po_line(po_id,line_no,item_id,qty,net_price,original_requested_date,current_delivery_date)
         values ($1,$2,$3,$4,$5,$6,$6) returning id`, [po, n * 10, item, l.qty, l.price, r.received]))!.id;
      await c.query("insert into mrreg_line(mrreg_id,line_no,po_line_id,item_id,qty_received,uom) values ($1,$2,$3,$4,$5,$6)",
        [mr, n, pl, item, l.qty, l.uom]);
    }
  }
}

async function main() {
  await runOnce(MARKER, async () => {
    await tx(masterData);

    const u = Object.fromEntries(
      await Promise.all(["qc", "qcm", "whs", "gm", "pur", "pch"].map(async (l) => [l, await loadActor(`${l}@demo.local`)] as const)),
    );
    const mrreg = async (no: string) => (await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = $1", [no]))!.id;
    const cat = async (name: string) => String((await one<{ id: number }>(pool, "select id from problem_category where name = $1", [name]))!.id);

    /** A draft with header, items and evidence, ready to submit. */
    async function draft(no: string, created: string, h: { date: string; time: string; status: "FAILED" | "HOLD" | "OTHER"; hold?: string;
      category: string; desc: string; followUp: string }, items: [number, number, number][], photos: [string, [number, number, number]][], note = "") {
      const id = await ncf.createDraft(u.qc, await mrreg(no), at(created));
      await ncf.updateHeader(u.qc, id, {
        inspect_date: h.date, inspect_time: h.time, goods_status: h.status, hold_note: h.hold ?? "",
        problem_category_id: await cat(h.category), problem_desc: h.desc, follow_up: h.followUp,
      });
      const lines = await ncf.mrregLines(id);
      for (const [i, [sample, defect, ret]] of items.entries()) await ncf.addItem(u.qc, id, lines[i].id, sample, defect, ret);
      if (photos.length) await ncf.addEvidence(u.qc, id, photos.map(([n, c]) => photo(n, c)), note);
      return id;
    }
    const approveAll = async (id: number, times: string[]) => {
      for (const [i, who] of ["qcm", "whs", "gm"].entries()) if (times[i]) await ncf.decide(u[who], id, "APPROVED", PW, "", at(times[i]));
    };
    const capa = (o: Partial<sup.CapaInput>): sup.CapaInput => ({
      root_cause: "", corrective_action: "", target_date: "", preventive_action: "", effective_from: "",
      responder_name: "", responder_position: "", responder_email: "", confirm: true, ...o,
    });

    // 1. CLOSED: the paper NCF 423/X/2026 case, from goods receipt to closure.
    const closed = await draft("MR-2026-10-0001", "2026-10-15 09:10",
      { date: "2026-10-15", time: "08:45", status: "FAILED", category: "Printing / finishing",
        desc: "Printing jelek di bagian belakang box, tinta pudar dan tidak rata.", followUp: "Retur semua. Barang 1: 100. Barang 2: 65." },
      [[32, 32, 100], [20, 20, 65]], [["box-belakang-1.png", [150, 120, 90]], ["box-belakang-2.png", [140, 110, 85]]],
      "Foto sisi belakang box");
    await ncf.submit(u.qc, closed, PW, at("2026-10-15 10:00"));
    await approveAll(closed, ["2026-10-15 13:20", "2026-10-16 08:40", "2026-10-16 11:05"]);
    const c1 = (await ncf.send(u.pur, closed, "LINK", at("2026-10-16 14:00"))).link.split("/s/")[1];
    await sup.openForSupplier(c1, at("2026-10-19 08:30"));
    await sup.respond(c1, capa({
      root_cause: "Tinta printer habis pada shift malam dan QC akhir tidak memeriksa sisi belakang box.",
      corrective_action: "Cetak ulang 165 box dan kirim pengganti bersama pengiriman berikutnya.", target_date: "2026-10-30",
      preventive_action: "Checklist QC akhir ditambah pemeriksaan sisi belakang; stok tinta dicek tiap awal shift.", effective_from: "2026-10-22",
      responder_name: "Hendra", responder_position: "QA Manager", responder_email: "hendra@premier.demo",
    }), [photo("checklist-qc-baru.png", [90, 130, 160])], { ip: "203.0.113.10" }, at("2026-10-20 10:15"));
    await ncf.close(u.pur, closed, "CAPA diterima. Box pengganti diperiksa saat datang 30/10 dan sesuai.", at("2026-10-30 15:00"));

    // 2. RESPONDED: the supplier answered; Purchasing still has to verify and close.
    const responded = await draft("MR-2026-10-0102", "2026-10-21 08:30",
      { date: "2026-10-21", time: "08:10", status: "FAILED", category: "Damaged",
        desc: "Karton penyok dan basah di sudut, 46 dari 80 sample tidak layak pakai.", followUp: "Retur karton rusak, minta penggantian 120 pcs." },
      [[80, 46, 120]], [["karton-penyok.png", [170, 140, 100]]], "Karton di area receiving");
    await ncf.submit(u.qc, responded, PW, at("2026-10-21 09:15"));
    await approveAll(responded, ["2026-10-21 11:00", "2026-10-21 14:30", "2026-10-22 09:10"]);
    const c2 = (await ncf.send(u.pur, responded, "LINK", at("2026-10-22 13:00"))).link.split("/s/")[1];
    await sup.openForSupplier(c2, at("2026-10-23 09:00"));
    await sup.respond(c2, capa({
      root_cause: "Truk pengiriman tidak tertutup terpal saat hujan; palet tidak dibungkus stretch film.",
      corrective_action: "Kirim 120 karton pengganti pada 05/11.", target_date: "2026-11-05",
      preventive_action: "Semua palet dibungkus stretch film dan truk wajib bertutup. Checklist muat ditandatangani supir.",
      effective_from: "2026-10-28", responder_name: "Rina Kusuma", responder_position: "QC Supervisor", responder_email: "rina@megakemas.demo",
    }), [], { ip: "203.0.113.22" }, at("2026-10-26 16:40"));

    // 3. SENT: link generated and emailed by Purchasing; the supplier opened it but has not answered yet.
    const sentEmail = await draft("MR-2026-10-0118", "2026-10-28 10:00",
      { date: "2026-10-28", time: "09:30", status: "FAILED", category: "Dimension",
        desc: "Engsel: lubang cup 33 mm, spesifikasi 35 mm. Handle: jarak lubang 126 mm, spesifikasi 128 mm.",
        followUp: "Retur seluruh engsel. Handle ditahan sampai konfirmasi supplier." },
      [[50, 50, 2000], [32, 18, 1000]], [["engsel-ukur.png", [120, 120, 130]], ["handle-ukur.png", [60, 60, 70]]], "Pengukuran dengan jangka sorong");
    await ncf.submit(u.qc, sentEmail, PW, at("2026-10-28 11:00"));
    await approveAll(sentEmail, ["2026-10-29 09:00", "2026-10-29 13:45", "2026-10-30 10:20"]);
    const c3 = (await ncf.send(u.pur, sentEmail, "LINK", at("2026-11-02 09:30"))).link.split("/s/")[1];
    await sup.openForSupplier(c3, at("2026-11-03 10:05"));

    // 4. APPROVED: all three signatures in; waiting for Purchasing to send.
    const approved = await draft("MR-2026-11-0003", "2026-11-04 08:20",
      { date: "2026-11-04", time: "08:00", status: "OTHER", category: "Quantity short",
        desc: "Panjang per roll kurang: rata-rata 46 m dari 50 m yang tertulis di label (sample 30 roll).",
        followUp: "Diterima dengan potongan kuantitas; minta kekurangan dikirim susulan." },
      [[30, 30, 0]], [["rotan-ukur-panjang.png", [170, 150, 110]]]);
    await ncf.submit(u.qc, approved, PW, at("2026-11-04 09:00"));
    await approveAll(approved, ["2026-11-04 15:30", "2026-11-05 10:00", "2026-11-06 09:15"]);

    // 5. SENT as a link: the supplier has no email, so the link is shared by WhatsApp. Not opened yet.
    const sentLink = await draft("MR-2026-11-0007", "2026-11-06 09:00",
      { date: "2026-11-06", time: "08:30", status: "FAILED", category: "Dimension",
        desc: "Kaki meja melengkung lebih dari 3 mm pada 14 dari 40 sample; beberapa retak di sambungan.",
        followUp: "Retur 14 pcs yang melengkung dan retak." },
      [[40, 14, 14]], [["kaki-meja-lengkung.png", [130, 90, 60]]]);
    await ncf.submit(u.qc, sentLink, PW, at("2026-11-06 10:00"));
    await approveAll(sentLink, ["2026-11-06 14:00", "2026-11-07 09:30", "2026-11-09 08:50"]);
    await ncf.send(u.pch, sentLink, "LINK", at("2026-11-09 11:00"));

    // 6. WAITING APPROVAL, step 2: the QC Manager signed; the Material WHS Manager is next.
    const step2 = await draft("MR-2026-11-0011", "2026-11-09 09:40",
      { date: "2026-11-09", time: "09:15", status: "FAILED", category: "Printing / finishing",
        desc: "Warna hitam belang pada 12 dari 32 sample, terlihat jelas di bawah lampu gudang.", followUp: "Retur 12 pcs." },
      [[32, 12, 12]], [["warna-belang.png", [50, 50, 55]]]);
    await ncf.submit(u.qc, step2, PW, at("2026-11-09 10:30"));
    await approveAll(step2, ["2026-11-10 08:45"]);

    // 7. WAITING APPROVAL after a return: the QC Manager sent it back, QC added evidence and signed version 2.
    const returned = await draft("MR-2026-11-0014", "2026-11-10 13:00",
      { date: "2026-11-10", time: "12:30", status: "HOLD", hold: "Ditahan di gudang karantina, menunggu konfirmasi supplier soal ketebalan.",
        category: "Dimension", desc: "Ketebalan dinding karton 4 mm, spesifikasi 5 ply minimal 6 mm.", followUp: "Hold seluruh lot sampai ada konfirmasi." },
      [[50, 50, 0]], [["karton-tebal.png", [175, 145, 105]]]);
    await ncf.submit(u.qc, returned, PW, at("2026-11-10 14:00"));
    await ncf.decide(u.qcm, returned, "RETURNED", PW, "Tambahkan foto pengukuran ketebalan dengan jangka sorong.", at("2026-11-11 09:00"));
    await ncf.addEvidence(u.qc, returned, [photo("ukur-tebal-jangka-sorong.png", [100, 110, 120])], "Pengukuran ketebalan");
    await ncf.submit(u.qc, returned, PW, at("2026-11-11 10:30"));

    // 8. VOID: the QC Manager rejected it; the reason is kept.
    const voided = await draft("MR-2026-11-0016", "2026-11-10 15:00",
      { date: "2026-11-10", time: "14:40", status: "FAILED", category: "Wrong item",
        desc: "Warna handle hitam doff, PO menyebut hitam glossy.", followUp: "Retur seluruh handle." },
      [[32, 32, 600]], [["handle-doff.png", [40, 40, 45]]]);
    await ncf.submit(u.qc, voided, PW, at("2026-11-10 15:30"));
    await ncf.decide(u.qcm, voided, "REJECTED", PW, "Bukan cacat: PO revisi B sudah mengganti ke hitam doff.", at("2026-11-11 08:30"));

    // 9. DRAFT: QC is still filling it in (no evidence yet).
    await draft("MR-2026-11-0019", "2026-11-12 08:15",
      { date: "2026-11-12", time: "08:00", status: "FAILED", category: "Damaged",
        desc: "Beberapa roll rotan tergores dan pecah di bagian luar.", followUp: "" },
      [[20, 5, 5]], []);

    // Reminders for open requests, as the daily job would send them today.
    const sent = await sup.runReminders();
    console.log(`demo: 9 NCFs created, one per status; ${sent.length} reminder(s) queued`);
  });
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
