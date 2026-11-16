"use client";

/** One-tap reasons for returning or rejecting an NCF; each adds its sentence to the comment box. */
export function ReasonChips({ target, reasons }: { target: string; reasons: string[] }) {
  const add = (text: string) => {
    const box = document.getElementById(target) as HTMLTextAreaElement | null;
    if (!box) return;
    box.value = box.value.trim() ? `${box.value.trim()} ${text}` : text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <button key={r} type="button" onClick={() => add(r)}
          className="rounded-full border border-hairline bg-slate-50 px-2.5 py-1 text-[12px] text-slate-700 hover:border-slate-300 hover:bg-white">
          {r}
        </button>
      ))}
    </div>
  );
}
