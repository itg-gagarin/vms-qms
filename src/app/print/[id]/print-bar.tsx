"use client";

import { useEffect } from "react";

/**
 * Back link and the print button. `fileName` becomes the document title right before printing, because the browser
 * offers the title as the PDF file name and the dialog may open before streamed metadata arrives.
 */
export function PrintBar({ back, autoPrint = false, label, fileName }: { back: string; autoPrint?: boolean; label: string; fileName: string }) {
  const print = () => {
    document.title = fileName;
    window.print();
  };
  useEffect(() => {
    document.title = fileName;
    if (autoPrint) window.print();
  }, [autoPrint, fileName]);
  return (
    <div className="no-print mx-auto mb-2 flex w-[794px] max-w-full items-center justify-between px-2">
      <a href={back}>← Back</a>
      <button className="btn btn-advance" onClick={print}>{label}</button>
    </div>
  );
}
