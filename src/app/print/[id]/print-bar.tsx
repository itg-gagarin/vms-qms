"use client";

export function PrintBar({ back }: { back: string }) {
  return (
    <div className="no-print mx-auto flex w-[794px] items-center justify-between">
      <a href={back}>← Back</a>
      <button className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
    </div>
  );
}
