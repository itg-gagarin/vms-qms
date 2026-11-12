import { createHash, randomBytes } from "node:crypto";

export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** URL-safe random token, 32 bytes of entropy by default. */
export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");

/** JSON with sorted keys, so the same content always gives the same hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
      .join(",") +
    "}"
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export const romanMonth = (m: number) => ROMAN.at(m - 1) ?? String(m);

export const TZ = "Asia/Jakarta";

/** Date and time parts in WIB. */
export function wib(d: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`,
    year: Number(get("year")),
    month: Number(get("month")),
  };
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00+07:00" : d) : d;
  return new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return (
    new Intl.DateTimeFormat("id-ID", {
      timeZone: TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date) + " WIB"
  );
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}
