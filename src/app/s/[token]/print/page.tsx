import { PrintBar } from "@/app/print/[id]/print-bar";
import { PrintForm } from "@/components/print-form";
import { Banner, Shell } from "@/components/ui";
import { openForSupplier } from "@/lib/supplier";
import { AppError } from "@/lib/util";

// The supplier's copy: Page 1, plus Page 2 once they have answered.
export default async function SupplierPrint({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data: Awaited<ReturnType<typeof openForSupplier>> | null = null;
  let error = "";
  try {
    data = await openForSupplier(token);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  if (!data) {
    return (
      <Shell>
        <Banner kind="error">{error}</Banner>
      </Shell>
    );
  }
  const { ncf: d, canRespond } = data;
  return (
    <div className="bg-slate-300 py-2 print:bg-white print:py-0">
      <PrintBar back={`/s/${token}`} />
      <PrintForm d={d} pages={canRespond ? 1 : 2} meta={{ kind: "COPY", copy: 1, printedBy: d.supplier_name, printedAt: new Date() }} />
    </div>
  );
}
