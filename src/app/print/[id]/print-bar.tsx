"use client";

import { useEffect } from "react";

export function PrintBar({ back, autoPrint = false, label }: { back: string; autoPrint?: boolean; label: string }) {
  useEffect(() => {
    if (autoPrint) window.print();
  }, [autoPrint]);
  return (
    <div className="no-print mx-auto mb-2 flex w-[794px] items-center justify-between">
      <a href={back}>← Back</a>
      <button className="btn btn-advance" onClick={() => window.print()}>{label}</button>
    </div>
  );
}
