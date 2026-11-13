// Shared by the demo loaders (demo-data.ts, demo-sap.ts). Demo data is made through the real business rules.
import { deflateSync, crc32 } from "node:zlib";
import { loadActor as loadById } from "../src/lib/core.ts";
import { one, pool } from "../src/lib/db.ts";

export const PW = process.env.SEED_PASSWORD ?? "demo1234";

export async function loadActor(email: string) {
  const u = await one<{ id: number }>(pool, "select id from app_user where email = $1", [email]);
  if (!u) throw new Error(`Demo user ${email} is missing: run db:seed first.`);
  return (await loadById(pool, u.id))!;
}

/** Runs fn unless one of the marker receipts exists. Refuses a production database unless DEMO_DATA=1. */
export async function runOnce(markers: string[], fn: () => Promise<void>) {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_DATA !== "1") {
    throw new Error("demo: refusing to run in production without DEMO_DATA=1");
  }
  if (await one(pool, "select 1 from mrreg where mrreg_no = any($1)", [markers])) {
    console.log(`demo (${markers[0]}): already loaded, nothing to do`);
    return;
  }
  await fn();
}

/** A moment in WIB, e.g. at("2026-10-15 09:10"). */
export const at = (s: string) => new Date(s.replace(" ", "T") + ":00+07:00");

/** The supplier's emailed reply, as Purchasing saves it (a text file standing in for the email). */
export const reply = (name: string, text: string) => new File([Buffer.from(text)], name, { type: "text/plain" });

/** A plain striped PNG standing in for an inspection photo. */
export function photo(name: string, rgb: [number, number, number]) {
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

/** Item group by the SAP item-code prefix, as in the export. */
export const GROUP: Record<string, string> = {
  RP: "Raw Material Packaging", RH: "Raw Material Hardware", RB: "Raw Material Board", RC: "Raw Material Cat",
  RM: "Raw Material Rotan", SP: "Sparepart", GM: "General Material", SN: "Support Production",
};

