import { currentUser } from "@/lib/auth";
import { selectedBu } from "@/lib/bu";
import { isNcfStatus } from "@/lib/labels";
import { exportXlsx } from "@/lib/reports";
import { AppError, wib } from "@/lib/util";

// Bulk export for QC, approvers and auditors: one .xlsx with an NCF sheet and an Items sheet, same filters as Reports.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const p = new URL(req.url).searchParams;
  const today = wib(new Date()).date;
  const from = p.get("from") || `${today.slice(0, 4)}-01-01`;
  const to = p.get("to") || today;
  const status = p.get("status");
  try {
    const x = await exportXlsx(user, {
      from, to, status: isNcfStatus(status) ? status : undefined, supplierId: p.get("supplier") ? Number(p.get("supplier")) : undefined,
      buId: await selectedBu(user),
    });
    return new Response(new Uint8Array(x.buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="NCF-${from}_${to}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status ?? 400 });
    throw e;
  }
}
