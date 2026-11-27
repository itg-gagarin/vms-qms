import { FlaskConical } from "lucide-react";
import { connection } from "next/server";
import { isStaging, STAGE_BANNER_PX } from "@/platform/environment";

/**
 * Staging only: an amber bar across the top of every page (app, login, QR pages, print preview) so nobody mistakes the
 * QA copy for production. Nothing renders on production. It is not printed; printed forms get their own watermark.
 */
export async function StageBanner() {
  await connection();
  if (!isStaging()) return null;
  return (
    <div role="status" style={{ height: STAGE_BANNER_PX }}
      className="no-print fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-400 px-3 text-[12px] font-medium text-amber-950 shadow-sm">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate"><b className="font-semibold tracking-wide">STAGING</b> · QA test environment, not production.<span className="hidden sm:inline"> NCFs, numbers and documents here are for testing only.</span></span>
    </div>
  );
}
