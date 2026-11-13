// Demo data. SAP is not connected in the MVP, so receipts and POs are seeded here.
// Receipt MR-2026-10-0001 reproduces paper NCF 423/X/2026 (Premier, two Tombu Spindle items).
import bcrypt from "bcryptjs";
import { Client } from "pg";

const PASSWORD = process.env.SEED_PASSWORD ?? "demo1234";

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const exists = await c.query("select 1 from business_unit limit 1");
  if (exists.rowCount) {
    console.log("seed: data already present, skipped");
    await c.end();
    return;
  }
  const hash = await bcrypt.hash(PASSWORD, 10);
  await c.query("begin");

  const bu = (await c.query(
    "insert into business_unit(code,name) values ('BU-DEMO','Demo Business Unit') returning id",
  )).rows[0].id;

  const users: [string, string, string, string[]][] = [
    ["qc", "Julianto", "QC Incoming", ["QC_INSPECTOR"]],
    ["qcm", "Rudi Hartono", "QC Manager", ["NCF_APPROVER"]],
    ["whs", "Agus Salim", "Material WHS Manager", ["NCF_APPROVER"]],
    ["gm", "Lina Wijaya", "General Manager", ["NCF_APPROVER"]],
    ["pur", "Sayyid", "Purchasing", ["PURCHASING"]],
    ["pch", "Dewi Lestari", "PCH Div. Head", ["PCH_DIV_HEAD"]],
    ["audit", "Compliance Auditor", "Compliance", ["AUDITOR"]],
    ["admin", "PMO Admin", "PMO", ["SUPER_ADMIN"]],
  ];
  const uid: Record<string, number> = {};
  for (const [login, name, position, roles] of users) {
    const id = (await c.query(
      "insert into app_user(name,position,email,password_hash) values ($1,$2,$3,$4) returning id",
      [name, position, `${login}@demo.local`, hash],
    )).rows[0].id;
    uid[login] = id;
    for (const r of roles) {
      // Approvers and QC are scoped to the BU; the others see all BUs.
      const scoped = r === "QC_INSPECTOR" || r === "NCF_APPROVER";
      await c.query("insert into user_role(user_id,role,bu_id) values ($1,$2,$3)", [id, r, scoped ? bu : null]);
    }
  }

  const chain: [number, string, string][] = [
    [1, "QC Manager", "qcm"],
    [2, "Material WHS Manager", "whs"],
    [3, "GM", "gm"],
  ];
  for (const [step, title, login] of chain) {
    await c.query(
      "insert into approval_chain_step(bu_id,step_no,approver_title,approver_id) values ($1,$2,$3,$4)",
      [bu, step, title, uid[login]],
    );
  }

  const premier = (await c.query(
    "insert into supplier(sap_vendor_code,name) values ('V0001','Premier') returning id",
  )).rows[0].id;
  await c.query(
    "insert into supplier_contact(supplier_id,name,email) values ($1,'Premier QA','qa@premier.demo')",
    [premier],
  );
  const noEmail = (await c.query(
    "insert into supplier(sap_vendor_code,name) values ('V0002','CV Sinar Kayu') returning id",
  )).rows[0].id;
  await c.query(
    "insert into supplier_contact(supplier_id,name,email,phone) values ($1,'Pak Budi',null,'0812-0000-0000')",
    [noEmail],
  );

  const item = async (code: string, desc: string) =>
    (await c.query("insert into item(sap_material_code,description,uom) values ($1,$2,'PCS') returning id", [code, desc])).rows[0].id;
  const iBlack = await item("RP.001.0008.0005.00419", "Tombu Spindle Queen Bed Box 2 Black");
  const iWhite = await item("RP.001.0008.0005.00506", "Tombu Spindle Queen Bed Box 2 White");
  const iLeg = await item("RP.001.0009.0001.00101", "Kaki Meja Jati 72 cm");

  const po = async (no: string, sup: number, date: string) =>
    (await c.query(
      "insert into purchase_order(po_no,supplier_id,po_date,currency,synced_at) values ($1,$2,$3,'IDR',now()) returning id",
      [no, sup, date],
    )).rows[0].id;
  const poLine = async (poId: number, line: number, itemId: number, qty: number, price: number, req: string) =>
    (await c.query(
      `insert into po_line(po_id,line_no,item_id,qty,net_price,original_requested_date,current_delivery_date)
       values ($1,$2,$3,$4,$5,$6,$6) returning id`,
      [poId, line, itemId, qty, price, req],
    )).rows[0].id;
  const po1 = await po("4500012345", premier, "2026-09-20");
  const pl1 = await poLine(po1, 10, iBlack, 100, 185000, "2026-10-14");
  const pl2 = await poLine(po1, 20, iWhite, 65, 185000, "2026-10-14");
  const po2 = await po("4500012399", noEmail, "2026-10-01");
  const pl3 = await poLine(po2, 10, iLeg, 200, 42000, "2026-11-05");

  const mr = async (no: string, sup: number, sj: string, sjDate: string, rcv: string) =>
    (await c.query(
      "insert into mrreg(mrreg_no,bu_id,supplier_id,sj_no,sj_date,receipt_date,synced_at) values ($1,$2,$3,$4,$5,$6,now()) returning id",
      [no, bu, sup, sj, sjDate, rcv],
    )).rows[0].id;
  const mrLine = (mrId: number, line: number, plId: number, itemId: number, qty: number) =>
    c.query(
      "insert into mrreg_line(mrreg_id,line_no,po_line_id,item_id,qty_received,uom) values ($1,$2,$3,$4,$5,'PCS')",
      [mrId, line, plId, itemId, qty],
    );
  const mr1 = await mr("MR-2026-10-0001", premier, "SJ-PRM-0410", "2026-10-13", "2026-10-14");
  await mrLine(mr1, 1, pl1, iBlack, 100);
  await mrLine(mr1, 2, pl2, iWhite, 65);
  const mr2 = await mr("MR-2026-11-0007", noEmail, "SJ-SK-1102", "2026-11-04", "2026-11-05");
  await mrLine(mr2, 1, pl3, iLeg, 200);
  // One receipt, two POs of the same supplier: QC picks the PO before the items.
  const po3 = await po("4500012367", premier, "2026-10-20");
  const pl4 = await poLine(po3, 10, iWhite, 50, 185000, "2026-11-10");
  const mr3 = await mr("MR-2026-11-0009", premier, "SJ-PRM-1109", "2026-11-09", "2026-11-10");
  await mrLine(mr3, 1, pl1, iBlack, 40);
  await mrLine(mr3, 2, pl4, iWhite, 50);

  for (const name of ["Printing / finishing", "Dimension", "Damaged", "Wrong item", "Quantity short", "Other"]) {
    await c.query("insert into problem_category(name) values ($1)", [name]);
  }

  // Working-day calendar: weekends off. Public holidays still have to be loaded (open point).
  await c.query(`
    insert into calendar_day(day,is_working)
    select d::date, extract(isodow from d) < 6
    from generate_series('2026-01-01'::date, '2027-12-31'::date, interval '1 day') d`);

  const setting = (key: string, value: unknown) =>
    c.query("insert into setting(key,value,changed_by,valid_from) values ($1,$2,$3,'2026-01-01')", [
      key,
      JSON.stringify(value),
      uid.admin,
    ]);
  await setting("reminder_window_wd", 2);
  await setting("reminder_max", 3);
  await setting("token_valid_days", 30);

  // Continue the paper register: the last paper NCF was 423/X/2026.
  await c.query("insert into doc_counter(key,last) values ('NCF-2026',423)");

  await c.query("commit");
  await c.end();
  console.log(`seed: done. Logins: qc, qcm, whs, gm, pur, pch, audit, admin @demo.local, password ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
