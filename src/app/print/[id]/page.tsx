import { notFound } from "next/navigation";
import { PrintForm } from "@/components/print-form";
import { requireUser } from "@/lib/auth";
import { getNcf } from "@/lib/ncf";
import { AppError } from "@/lib/util";
import { logPrint } from "@/lib/verify";
import { PrintBar } from "./print-bar";

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let d;
  try {
    d = await getNcf(user, Number(id));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const log = await logPrint(user, d.id, d.status);
  const pages = ["SENT", "RESPONDED", "CLOSED"].includes(d.status) ? 2 : 1;
  return (
    <div className="bg-slate-300 py-2 print:bg-white print:py-0">
      <PrintBar back={`/ncf/${d.id}`} />
      <PrintForm d={d} pages={pages} meta={{ kind: log.kind, copy: log.copy, printedBy: user.name, printedAt: new Date() }} />
    </div>
  );
}
