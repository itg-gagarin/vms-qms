import { notFound } from "next/navigation";
import { PrintForm } from "@/components/print-form";
import { requireUser } from "@/lib/auth";
import { getNcf } from "@/lib/ncf";
import { AppError } from "@/lib/util";
import { logPrint } from "@/lib/verify";
import { PrintBar } from "./print-bar";

/**
 * The A4 form. With ?export=1 it is the supplier's copy: both pages (Part 2 for the supplier to fill in), no QR codes,
 * and the print dialog opens so Purchasing can save it as PDF.
 */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ export?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const external = (await searchParams).export === "1";
  let d;
  try {
    d = await getNcf(user, Number(id));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const log = await logPrint(user, d.id, d.status);
  const pages = external || ["APPROVED", "SENT", "RESPONDED", "CLOSED"].includes(d.status) ? 2 : 1;
  return (
    <div className="bg-slate-300 py-2 print:bg-white print:py-0">
      <PrintBar back={`/ncf/${d.id}`} autoPrint={external} label={external ? "Save as PDF for the supplier" : "Print or save as PDF"} />
      <PrintForm d={d} pages={pages} meta={{ kind: log.kind, copy: log.copy, printedBy: user.name, printedAt: new Date(), external }} />
    </div>
  );
}
