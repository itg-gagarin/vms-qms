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
          className="rounded-md border bg-background px-2.5 py-1 text-xs shadow-xs text-foreground/80 hover:bg-accent">
          {r}
        </button>
      ))}
    </div>
  );
}
