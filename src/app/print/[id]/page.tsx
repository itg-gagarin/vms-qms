import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PrintForm } from "@/components/print-form";
import { requireUser } from "@/lib/auth";
import { getNcf } from "@/lib/ncf";
import { AppError, wib } from "@/lib/util";
import { logPrint } from "@/lib/verify";
import { PrintBar } from "./print-bar";

// One read per request, shared by the title and the page.
const load = cache(async (id: number) => {
  const user = await requireUser();
  try {
    return { user, d: await getNcf(user, id) };
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
});

/**
 * The browser offers the page title as the file name when saving as PDF:
 * "439/XI/2026_13112026_UD Rotan Abadi - Integra Group" (No. Komplain, Tanggal Buat as ddmmyyyy, supplier).
 * Browsers replace characters a file name cannot hold, such as "/", with "_".
 */
function fileName(d: { ncf_no: string; created_at: Date; supplier_name: string }) {
  const [y, m, day] = wib(d.created_at).date.split("-");
  return `${d.ncf_no}_${day}${m}${y}_${d.supplier_name} - Integra Group`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { d } = await load(Number((await params).id));
  return { title: { absolute: fileName(d) }, robots: { index: false } };
}

/**
 * The A4 form. With ?export=1 it is the supplier's copy: both pages (Part 2 for the supplier to fill in), the same QR
 * codes, and the print dialog opens so Purchasing can save it as PDF.
 */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ export?: string }> }) {
  const { id } = await params;
  const external = (await searchParams).export === "1";
  const { user, d } = await load(Number(id));
  const log = await logPrint(user, d.id, d.status);
  const pages = external || ["APPROVED", "SENT", "RESPONDED", "CLOSED"].includes(d.status) ? 2 : 1;
  return (
    <div className="bg-slate-300 py-2 print:bg-white print:py-0">
      <PrintBar back={`/ncf/${d.id}`} autoPrint={external} fileName={fileName(d)} label={external ? "Save as PDF for the supplier" : "Print or save as PDF"} />
      <PrintForm d={d} pages={pages} meta={{ kind: log.kind, copy: log.copy, printedBy: user.name, printedAt: new Date(), external }} />
    </div>
  );
}
