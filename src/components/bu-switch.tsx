"use client";

import { Building2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { setBuAction } from "@/app/(app)/bu-actions";

export type BuOption = { id: number; code: string; name: string };

/**
 * The Business Unit being looked at. One unit: shown as a label. Several (or all): a select that switches at once
 * and stays on the same page.
 */
export function BuSwitch({ units, selected, id = "bu-switch" }: { units: BuOption[]; selected?: number; id?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  if (units.length === 0) return null;
  if (units.length === 1) {
    return (
      <span className="flex items-center gap-1.5 rounded-sm border border-hairline bg-white px-2.5 py-1.5 text-[13px] text-slate-700" title={units[0].name}>
        <Building2 size={15} className="text-slate-400" aria-hidden="true" />
        <span className="max-w-[160px] truncate">{units[0].name}</span>
      </span>
    );
  }
  const back = `${pathname}${params.size ? `?${params}` : ""}`;
  return (
    <form ref={ref} action={setBuAction} className="flex items-center">
      <input type="hidden" name="back" value={back} />
      <label htmlFor={id} className="sr-only">Business Unit</label>
      <div className="relative">
        <Building2 size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <select id={id} name="bu" defaultValue={selected ? String(selected) : "all"} onChange={() => ref.current?.requestSubmit()}
          className="input h-9 w-auto max-w-[220px] bg-white pl-8 pr-8 text-[13px] md:h-9">
          <option value="all">All business units</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
        </select>
      </div>
    </form>
  );
}
