"use client";

import { X } from "lucide-react";
import { createContext, useContext, useRef, type ReactNode } from "react";

const Close = createContext<() => void>(() => {});
/** Inside a modal: closes it (pass to ActionForm's onOk to close after a successful save). */
export const useCloseModal = () => useContext(Close);

/**
 * A button that opens a dialog with a form. The native <dialog> gives focus trapping, Esc to close and a backdrop;
 * the look is ours. On phones it rises from the bottom as a sheet.
 */
export function Modal({ label, title, description, children, buttonClassName = "btn", icon }: {
  label: ReactNode; title: string; description?: ReactNode; children: ReactNode; buttonClassName?: string; icon?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" className={buttonClassName} onClick={() => ref.current?.showModal()}>{icon}{label}</button>
      <dialog ref={ref} aria-label={title}
        onClick={(e) => { if (e.target === ref.current) close(); }}
        className="m-0 mt-auto w-full max-w-none rounded-t-md border border-hairline bg-white p-0 text-ink shadow-[0_24px_64px_rgba(15,23,42,0.18)] backdrop:bg-ink/40 sm:m-auto sm:max-w-lg sm:rounded-md">
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <h2 className="h2">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <button type="button" onClick={close} className="-mr-1 rounded-sm p-1.5 text-muted hover:bg-row-hover" aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          <Close value={close}>{children}</Close>
        </div>
      </dialog>
    </>
  );
}
