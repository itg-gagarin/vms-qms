// A larger demo set in the shape of the SAP MRReg export (mrreg2026.xlsx): 9-digit MRReg and PO numbers, VLP/VSM/VIP
// vendor codes, "Name, PT" vendor names, item codes with their item group, SAP status and the export's dates.
// Then 30 NCFs across every status and the cases that matter: returned and re-signed (version 2), rejected at
// step 1 and at step 3, overdue suppliers with reminders, a supplier without email (sent by WhatsApp), Hold and
// Other goods status, multi-item and multi-PO receipts, and drafts at three levels of completeness.
// All suppliers, items and numbers are made up. Everything goes through the real business rules.
//
// Usage: npm run db:demo-sap          (local, after db:seed; db:demo is not required)
//        DEMO_DATA=1 at container start (see Dockerfile)
// Safe to run again: it stops if its first receipt already exists. Never run it on a database with real records.
import type { PoolClient } from "pg";
import { one, pool, tx } from "../src/lib/db.ts";
import * as ncf from "../src/lib/ncf.ts";
import * as pur from "../src/lib/purchasing.ts";
import { runReminders } from "../src/lib/reminders.ts";
import { at, GROUP, loadActor, photo, PW, reply, runOnce } from "./demo-lib.ts";

const FIRST_MRREG = 260014601;
const FIRST_PO = 260011001;

// A fixed pseudo-random sequence, so every run produces the same data.
let seed = 20261113;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;

type Item = { code: string; desc: string; uom: string; price: number };
type Supplier = { code: string; name: string; contact: string; email: string | null; phone?: string; sj: (n: number) => string; items: Item[] };

const SUPPLIERS: Supplier[] = [
  { code: "VLP02231", name: "Sentosa Kemasindo, PT", contact: "Hendra (QA Manager)", email: "qa@sentosakemas.demo", sj: (n) => `${n}/SKM/26`,
    items: [
      { code: "RP.002.0003.0100.00211", desc: "Karton Box 3 Ply 100x50x35", uom: "PCS", price: 12500 },
      { code: "RP.002.0009.0002.00045", desc: "Foam Sheet 2 mm Roll 100 m", uom: "ROLL", price: 310000 },
      { code: "RP.001.0011.0001.00008", desc: "Corner Protector Karton 50 mm", uom: "PCS", price: 900 },
    ] },
  { code: "VLP01544", name: "Mitra Logam Jaya, CV", contact: "Ratna (Sales Admin)", email: "sales@mitralogam.demo", sj: (n) => String(n),
    items: [
      { code: "RH.004.0002.0035.00011", desc: "Engsel Sendok 35 mm Full Overlay", uom: "PCS", price: 7200 },
      { code: "RH.004.0011.0006.00003", desc: "Rel Laci Double Track 45 cm", uom: "SET", price: 38500 },
      { code: "RH.004.0015.0004.00120", desc: "Sekrup Confirmat 7x50", uom: "BOX", price: 64000 },
    ] },
  { code: "VLP03017", name: "Prima Board Industri, PT", contact: "QC Department", email: "qc@primaboard.demo", sj: (n) => `PBI-${n}`,
    items: [
      { code: "RB.001.0002.0018.00031", desc: "MDF E1 18 mm 1220x2440", uom: "LBR", price: 298000 },
      { code: "RB.001.0002.0009.00027", desc: "Particle Board 9 mm 1220x2440", uom: "LBR", price: 142000 },
      { code: "RB.001.0005.0003.00006", desc: "HPL Walnut 0.8 mm", uom: "LBR", price: 176000 },
    ] },
  { code: "VLP00876", name: "Warna Cat Nusantara, PT", contact: "Technical Service", email: "ts@warnacat.demo", sj: (n) => `${n}/WCN/XI/26`,
    items: [
      { code: "RC.005.0001.0001.00102", desc: "Cat Duco Putih Doff 20 L", uom: "PAIL", price: 1450000 },
      { code: "RC.005.0003.0002.00017", desc: "Thinner NC Super 20 L", uom: "PAIL", price: 520000 },
      { code: "RC.005.0002.0004.00009", desc: "Sanding Sealer 20 L", uom: "PAIL", price: 980000 },
    ] },
  { code: "VSM00341", name: "Sumber Rotan Makmur, UD", contact: "Pak Joko", email: null, phone: "0813-0000-0341", sj: (n) => String(n),
    items: [
      { code: "RM.003.0005.0006.00012", desc: "Rotan Sintetis Pipih 6 mm Natural", uom: "ROLL", price: 99000 },
      { code: "RM.003.0001.0002.00004", desc: "Rotan Alam Core 4 mm", uom: "KG", price: 47000 },
    ] },
  { code: "VLP02790", name: "Teknik Sparepart Mandiri, CV", contact: "Admin Penjualan", email: "admin@teknikspm.demo", sj: (n) => `TSM/${n}`,
    items: [
      { code: "SP.007.0001.0010.00055", desc: "V-Belt B-52 Mesin Planer", uom: "PCS", price: 85000 },
      { code: "SP.007.0004.0002.00018", desc: "Bearing 6204 ZZ", uom: "PCS", price: 36000 },
    ] },
  { code: "VIP00112", name: "Guangdong Furniture Fittings Co., LTD.", contact: "Export Department", email: "export@gdfittings.demo", sj: (n) => `GD${n}`,
    items: [
      { code: "RH.004.0021.0001.00077", desc: "Handle Zinc Alloy 160 mm Gold", uom: "PCS", price: 24000 },
      { code: "RH.004.0019.0003.00012", desc: "Gas Lift Kursi 100 mm Class 3", uom: "PCS", price: 61000 },
    ] },
  { code: "VLP01902", name: "Karya Busa Abadi, PT", contact: "QA Busa", email: "qa@karyabusa.demo", sj: (n) => `${n}/KBA`,
    items: [
      { code: "RF.006.0002.0030.00015", desc: "Busa Lembaran D23 30 mm", uom: "LBR", price: 118000 },
      { code: "RF.006.0002.0050.00007", desc: "Busa Lembaran D32 50 mm", uom: "LBR", price: 236000 },
    ] },
];
const GROUPS: Record<string, string> = { ...GROUP, RF: "Raw Material Foam" };

/** Adds n working days (Mon to Fri) to a yyyy-mm-dd date. */
function wd(day: string, n: number) {
  const d = new Date(day + "T12:00:00Z");
  let left = n;
  while (left > 0 || [0, 6].includes(d.getUTCDay())) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) left--;
  }
  return d.toISOString().slice(0, 10);
}

type Receipt = { mrreg: string; supplier: Supplier; day: string; sapStatus: string; lines: { item: Item; qty: number; po: string }[] };

/** Working days after 6 July for receipt k: sparse in the summer, dense in late October and November. */
const offset = (k: number) => (k < 20 ? k * 3 : k < 30 ? 60 + (k - 20) * 2 : 80 + (k - 30));

/** 44 receipts from July to mid-November, oldest first. A few hold two POs of the same supplier. */
function receipts(): Receipt[] {
  const out: Receipt[] = [];
  let po = FIRST_PO;
  for (let k = 0; k < 44; k++) {
    const shifted = wd("2026-07-06", offset(k));
    const day = shifted > "2026-11-12" ? "2026-11-12" : shifted;
    const s = SUPPLIERS[k % SUPPLIERS.length]!;
    const n = Math.min(s.items.length, 1 + (k % 4 === 1 ? 2 : k % 5 === 2 ? 1 : 0));
    const twoPos = k % 9 === 4 && n > 1;
    const poA = String(po++);
    const poB = twoPos ? String(po++) : poA;
    out.push({
      mrreg: String(FIRST_MRREG + k), supplier: s, day,
      sapStatus: k === 37 ? "OPEN" : k === 23 ? "CANCELED" : day >= "2026-11-10" ? "CONFIRMED" : "CLOSED",
      lines: s.items.slice(0, n).map((item, i) => ({ item, qty: pick([24, 40, 60, 100, 120, 150, 200, 250, 300, 500, 800]), po: i === 0 ? poA : poB })),
    });
  }
  return out;
}

async function masterData(c: PoolClient, list: Receipt[]) {
  const bu = (await one<{ id: number }>(c, "select id from business_unit where code = 'BU-DEMO'"))!.id;
  for (const s of SUPPLIERS) {
    const id = (await one<{ id: number }>(c,
      "insert into supplier(sap_vendor_code,name) values ($1,$2) on conflict (sap_vendor_code) do update set name = excluded.name returning id", [s.code, s.name]))!.id;
    await c.query("insert into supplier_contact(supplier_id,name,email,phone) values ($1,$2,$3,$4)", [id, s.contact, s.email, s.phone ?? null]);
    for (const i of s.items) {
      await c.query(
        `insert into item(sap_material_code,description,uom,item_group) values ($1,$2,$3,$4)
         on conflict (sap_material_code) do update set item_group = excluded.item_group`,
        [i.code, i.desc, i.uom, GROUPS[i.code.slice(0, 2)] ?? "General Material"]);
    }
  }
  for (const r of list) {
    const supplier = (await one<{ id: number }>(c, "select id from supplier where sap_vendor_code = $1", [r.supplier.code]))!.id;
    const sjNo = r.supplier.sj(1000 + Number(r.mrreg.slice(-3)) * 7);
    const sjDay = new Date(new Date(r.day + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10); // SJ issued the day before
    const mr = (await one<{ id: number }>(c,
      `insert into mrreg(mrreg_no,bu_id,supplier_id,sj_no,sj_date,receipt_date,sap_status,sap_created_at,confirmed_on,sap_closed_at,synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,($6::date + time '07:40') at time zone 'Asia/Jakarta',
               case when $7 <> 'OPEN' then $6::date end,
               case when $7 = 'CLOSED' then ($6::date + 1 + time '14:05') at time zone 'Asia/Jakarta' end, now()) returning id`,
      [r.mrreg, bu, supplier, sjNo, sjDay, r.day, r.sapStatus]))!.id;
    let lineNo = 0;
    for (const l of r.lines) {
      lineNo++;
      const po = (await one<{ id: number }>(c,
        `insert into purchase_order(po_no,supplier_id,po_date,currency,synced_at) values ($1,$2,$3::date - 21,'IDR',now())
         on conflict (po_no) do update set synced_at = now() returning id`, [l.po, supplier, r.day]))!.id;
      const item = (await one<{ id: number }>(c, "select id from item where sap_material_code = $1", [l.item.code]))!.id;
      const pl = (await one<{ id: number }>(c,
        `insert into po_line(po_id,line_no,item_id,qty,open_qty,net_price,original_requested_date,current_delivery_date)
         values ($1,(select coalesce(max(line_no),0) + 10 from po_line where po_id = $1),$2,$3,0,$4,$5,$5) returning id`,
        [po, item, l.qty, l.item.price, r.day]))!.id;
      await c.query("insert into mrreg_line(mrreg_id,line_no,po_line_id,item_id,qty_received,qty_open,uom) values ($1,$2,$3,$4,$5,0,$6)",
        [mr, lineNo, pl, item, l.qty, l.item.uom]);
    }
  }
}

type Target = "DRAFT_FULL" | "DRAFT_PART" | "DRAFT_NEW" | "STEP1" | "STEP2" | "STEP3" | "RETURNED_V2" | "VOID1" | "VOID3"
  | "APPROVED" | "SENT" | "RESPONDED" | "CLOSED";
type Case = {
  r: number; target: Target; cat: string; goods: "FAILED" | "HOLD" | "OTHER"; desc: string; follow: string;
  /** sample, defect, return for each line used */ q: [number, number, number][];
  /** working days the supplier took (RESPONDED, CLOSED) */ reply?: number; byWhatsApp?: boolean; hold?: string;
};

// 30 NCFs. r is the receipt index (0 to 43; supplier = r mod 8); receipts left without an NCF stay in the Open list.
const CASES: Case[] = [
  // Closed: July to August, replies from 1 to 9 working days
  { r: 0, target: "CLOSED", cat: "Damaged", goods: "FAILED", desc: "Karton sobek di sisi lipatan, tidak kuat menahan tumpukan 5 box.", follow: "Retur karton sobek, minta penggantian.", q: [[40, 9, 9]], reply: 1 },
  { r: 1, target: "CLOSED", cat: "Dimension", goods: "FAILED", desc: "Diameter cup engsel 33.6 mm, spesifikasi 35 mm ± 0.2.", follow: "Retur seluruh engsel tidak sesuai ukuran.", q: [[50, 50, 120], [20, 2, 2], [10, 1, 1]], reply: 4 },
  { r: 2, target: "CLOSED", cat: "Damaged", goods: "FAILED", desc: "Permukaan MDF tergores dan sudut pecah akibat penanganan saat bongkar.", follow: "Retur lembar rusak.", q: [[30, 6, 6], [20, 3, 3]], reply: 7 },
  { r: 3, target: "CLOSED", cat: "Other", goods: "OTHER", desc: "Viskositas cat 95 KU, spesifikasi 80 to 90 KU. Hasil semprot meleleh.", follow: "Pakai dengan tambahan thinner sesuai arahan TS; minta CoA tiap batch.", q: [[3, 3, 0]], reply: 2 },
  { r: 5, target: "CLOSED", cat: "Quantity short", goods: "OTHER", desc: "V-belt per pak berisi 9 pcs, label 10 pcs (sample 10 pak).", follow: "Klaim kekurangan, dikirim susulan.", q: [[10, 10, 0]], reply: 3 },
  { r: 6, target: "CLOSED", cat: "Wrong item", goods: "FAILED", desc: "Handle warna silver, PO menyebut gold.", follow: "Retur seluruh handle.", q: [[32, 32, 240]], reply: 9 },
  { r: 8, target: "CLOSED", cat: "Printing / finishing", goods: "FAILED", desc: "Sablon logo pada karton buram dan bergeser 5 mm.", follow: "Retur karton cacat sablon.", q: [[50, 14, 14]], reply: 1 },
  { r: 10, target: "CLOSED", cat: "Dimension", goods: "FAILED", desc: "Tebal MDF 17.2 mm, spesifikasi 18 mm ± 0.3.", follow: "Retur seluruh lot.", q: [[20, 20, 300]], reply: 6 },
  { r: 11, target: "CLOSED", cat: "Damaged", goods: "HOLD", hold: "Ditahan di karantina; dicek ulang setelah 24 jam, 4 pail bocor.", desc: "Tutup pail penyok, 4 pail bocor.", follow: "Retur 4 pail bocor setelah konfirmasi.", q: [[10, 4, 4]], reply: 2 },
  { r: 14, target: "CLOSED", cat: "Printing / finishing", goods: "FAILED", desc: "Lapisan gold handle tergores, 12 dari 50 sample.", follow: "Retur handle tergores.", q: [[50, 12, 12]], reply: 5 },
  // Supplier replied, Purchasing still to verify and close
  { r: 16, target: "RESPONDED", cat: "Damaged", goods: "FAILED", desc: "Karton lembap, lem lepas di sambungan pada 11 dari 40 sample.", follow: "Retur karton lembap.", q: [[40, 11, 11]], reply: 2 },
  { r: 18, target: "RESPONDED", cat: "Other", goods: "OTHER", desc: "Permukaan MDF bergelombang, terlihat setelah dilapis HPL.", follow: "Pisahkan lembar bergelombang, minta penggantian.", q: [[15, 5, 0]], reply: 8 },
  { r: 21, target: "RESPONDED", cat: "Other", goods: "FAILED", desc: "Bearing berbunyi saat diputar manual, 6 dari 30 sample; satu V-belt retak.", follow: "Retur bearing berbunyi dan V-belt retak.", q: [[10, 1, 1], [30, 6, 6]], reply: 3 },
  { r: 25, target: "RESPONDED", cat: "Damaged", goods: "FAILED", desc: "Engsel tidak menutup rapat dan rel laci bengkok di ujung.", follow: "Retur engsel dan rel yang rusak.", q: [[40, 7, 7], [20, 3, 3]], reply: 5 },
  // Sent and waiting: from 16 working days overdue to 3 days
  { r: 27, target: "SENT", cat: "Quantity short", goods: "OTHER", desc: "Berat bersih per pail 18.6 kg, label 20 kg.", follow: "Klaim selisih berat.", q: [[5, 5, 0]] },
  { r: 28, target: "SENT", cat: "Damaged", goods: "FAILED", desc: "Rotan pipih pecah dan getas, 9 dari 40 roll.", follow: "Retur roll pecah.", q: [[40, 9, 9]], byWhatsApp: true },
  { r: 31, target: "SENT", cat: "Damaged", goods: "HOLD", hold: "Ditahan, menunggu supplier cek densitas.", desc: "Busa D23 terasa lebih lunak, densitas ukur 20.5 kg/m³.", follow: "Hold sampai hasil uji densitas supplier.", q: [[10, 10, 0]] },
  { r: 34, target: "SENT", cat: "Dimension", goods: "FAILED", desc: "Lembar MDF melengkung (bowing) 6 mm pada panjang 2440 mm.", follow: "Retur lembar melengkung.", q: [[20, 5, 5]] },
  { r: 39, target: "SENT", cat: "Damaged", goods: "FAILED", desc: "Busa D23 sobek di tepi potongan, 4 dari 20 lembar.", follow: "Retur busa sobek.", q: [[20, 4, 4]] },
  // Approved, Purchasing to send
  { r: 36, target: "APPROVED", cat: "Damaged", goods: "FAILED", desc: "Rotan alam core berjamur di bagian dalam ikatan.", follow: "Retur rotan berjamur.", q: [[25, 5, 5]] },
  { r: 40, target: "APPROVED", cat: "Dimension", goods: "FAILED", desc: "Ukuran dalam karton 98x48 cm, spesifikasi 100x50 cm.", follow: "Retur seluruh karton.", q: [[20, 20, 120]] },
  // In approval: waiting at step 1, 2 and 3, and one returned and signed again (version 2)
  { r: 43, target: "STEP1", cat: "Printing / finishing", goods: "FAILED", desc: "Hasil semprot cat duco belang setelah 2 lapis.", follow: "Retur 2 pail, uji ulang lot berikutnya.", q: [[4, 2, 2]] },
  { r: 41, target: "STEP2", cat: "Damaged", goods: "FAILED", desc: "Sekrup confirmat berkarat di dalam box, 3 dari 10 box.", follow: "Retur box berkarat.", q: [[10, 3, 3]] },
  { r: 35, target: "STEP3", cat: "Other", goods: "OTHER", desc: "Thinner keruh dan berendapan setelah didiamkan 1 jam.", follow: "Minta CoA dan penggantian bila tidak sesuai.", q: [[3, 3, 0]] },
  { r: 42, target: "RETURNED_V2", cat: "Dimension", goods: "FAILED", desc: "Tebal MDF 17.4 mm, spesifikasi 18 mm ± 0.3.", follow: "Retur lembar tidak sesuai.", q: [[20, 20, 60]] },
  // Rejected: by the QC Manager (step 1) and by the GM (step 3)
  { r: 12, target: "VOID1", cat: "Printing / finishing", goods: "FAILED", desc: "Warna rotan sedikit lebih gelap dari sample.", follow: "Retur.", q: [[10, 2, 2]] },
  { r: 30, target: "VOID3", cat: "Quantity short", goods: "OTHER", desc: "Jumlah handle 480 pcs, SJ 500 pcs.", follow: "Klaim kekurangan 20 pcs.", q: [[1, 1, 0]] },
  // Drafts: complete but not signed, partly filled, and just created on a two-PO receipt
  { r: 32, target: "DRAFT_FULL", cat: "Wrong item", goods: "FAILED", desc: "Karton tidak dilaminasi, PO menyebut karton laminasi.", follow: "Retur seluruh karton.", q: [[10, 10, 24]] },
  { r: 33, target: "DRAFT_PART", cat: "Damaged", goods: "FAILED", desc: "Rel laci macet saat ditarik penuh, 6 dari 20 set.", follow: "", q: [[20, 6, 6]] },
  { r: 22, target: "DRAFT_NEW", cat: "", goods: "FAILED", desc: "", follow: "", q: [] },
];

async function main() {
  const list = receipts();
  await runOnce([String(FIRST_MRREG)], async () => {
    await tx((c) => masterData(c, list));
    const u = Object.fromEntries(
      await Promise.all(["qc", "qcm", "whs", "gm", "pur", "pch"].map(async (l) => [l, await loadActor(`${l}@demo.local`)] as const)),
    );
    const mrregId = async (no: string) => (await one<{ id: number }>(pool, "select id from mrreg where mrreg_no = $1", [no]))!.id;
    const catId = async (name: string) =>
      String((await one<{ id: number }>(pool, "select id from problem_category where name = $1 or $1 = '' order by (name = $1) desc, id limit 1", [name]))!.id);
    const tally: Record<string, number> = {};
    const colors: [number, number, number][] = [[150, 120, 90], [120, 120, 130], [170, 140, 100], [60, 60, 70], [130, 90, 60], [175, 145, 105]];

    // Oldest first, so the NCF numbers run in the order the NCFs were raised.
    for (const k of [...CASES].sort((a, b) => a.r - b.r)) {
      const r = list[k.r]!;
      const d = r.day;                         // inspection on the registration day
      const poId = (await one<{ id: number }>(pool, "select id from purchase_order where po_no = $1", [r.lines[0]!.po]))!.id;
      const twoPos = new Set(r.lines.map((l) => l.po)).size > 1;
      const id = await ncf.createDraft(u.qc, await mrregId(r.mrreg), at(`${d} 08:${String(10 + (k.r % 40)).padStart(2, "0")}`), twoPos ? undefined : poId);
      tally[k.target] = (tally[k.target] ?? 0) + 1;
      if (k.target === "DRAFT_NEW") continue;
      if (twoPos) await ncf.setPo(u.qc, id, poId);
      await ncf.updateHeader(u.qc, id, {
        inspect_date: d, inspect_time: "08:00", goods_status: k.goods, hold_note: k.hold ?? "",
        problem_category_id: await catId(k.cat), problem_desc: k.desc, follow_up: k.follow,
      });
      const lines = await ncf.mrregLines(id);
      for (const [i, [sample, defect, ret]] of k.q.entries()) {
        if (!lines[i]) break;
        await ncf.addItem(u.qc, id, lines[i].id, Math.min(sample, lines[i].qty_received), Math.min(defect, sample, lines[i].qty_received),
          Math.min(ret, lines[i].qty_received));
      }
      if (k.target === "DRAFT_PART") continue;
      await ncf.addEvidence(u.qc, id, [photo(`${r.mrreg}-1.png`, colors[k.r % colors.length]!), ...(k.r % 2 ? [photo(`${r.mrreg}-2.png`, colors[(k.r + 2) % colors.length]!)] : [])],
        "Foto saat pemeriksaan");
      if (k.target === "DRAFT_FULL") continue;

      await ncf.submit(u.qc, id, PW, at(`${d} 10:05`));
      if (k.target === "VOID1") { await ncf.decide(u.qcm, id, "REJECTED", PW, "Bukan cacat: masih dalam batas toleransi visual.", at(`${d} 14:20`)); continue; }
      if (k.target === "RETURNED_V2") {
        await ncf.decide(u.qcm, id, "RETURNED", PW, "Lampirkan foto pengukuran dengan jangka sorong.", at(`${d} 13:40`));
        await ncf.addEvidence(u.qc, id, [photo(`${r.mrreg}-ukur.png`, [100, 110, 120])], "Pengukuran dengan jangka sorong");
        await ncf.submit(u.qc, id, PW, at(`${wd(d, 1)} 08:30`));
        continue;
      }
      if (k.target === "STEP1") continue;
      await ncf.decide(u.qcm, id, "APPROVED", PW, "", at(`${d} 14:10`));
      if (k.target === "STEP2") continue;
      await ncf.decide(u.whs, id, "APPROVED", PW, "", at(`${wd(d, 1)} 09:25`));
      if (k.target === "STEP3") continue;
      if (k.target === "VOID3") { await ncf.decide(u.gm, id, "REJECTED", PW, "Selisih masuk toleransi kontrak (5%). Tidak perlu NCF.", at(`${wd(d, 1)} 15:00`)); continue; }
      await ncf.decide(u.gm, id, "APPROVED", PW, "", at(`${wd(d, 1)} 15:10`));
      if (k.target === "APPROVED") continue;

      const sent = wd(d, k.r % 3 === 0 ? 3 : 2);
      await ncf.markSent(k.byWhatsApp ? u.pch : u.pur, id, at(`${sent} 10:${String(k.r % 50).padStart(2, "0")}`));
      if (k.target === "SENT") continue;
      const got = wd(sent, k.reply ?? 2);
      await pur.markReturned(u.pur, id, {
        receivedAt: at(`${got} 15:30`), note: `Balasan ${r.supplier.contact} via email`,
        files: [reply(`balasan-${r.mrreg}.txt`, `Akar masalah dan tindakan perbaikan dari ${r.supplier.name} untuk MRReg ${r.mrreg}.`)],
      }, at(`${got} 15:45`));
      if (k.target === "RESPONDED") continue;
      await ncf.close(u.pur, id, at(`${wd(got, 1)} 11:00`));
    }

    const reminders = await runReminders();
    console.log(`demo-sap: ${list.length} SAP receipts, ${CASES.length} NCFs (${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", ")}); ${reminders.length} reminder(s)`);
  });
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
