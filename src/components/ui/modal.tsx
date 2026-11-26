"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";

const Close = createContext<() => void>(() => {});
/** Inside a modal: closes it (pass to ActionForm's onOk to close after a successful save). */
export const useCloseModal = () => useContext(Close);

/**
 * A button that opens a shadcn Dialog with a form. On phones the dialog rises from the bottom as a sheet, clear of the
 * home indicator. The content mounts when opened, so every opening starts with a fresh form.
 */
export function Modal({ label, title, description, children, buttonClassName = "btn", icon }: {
  label: ReactNode; title: string; description?: ReactNode; children: ReactNode; buttonClassName?: string; icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={buttonClassName}>{icon}{label}</button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[92dvh] gap-0 overflow-y-auto p-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:data-[state=open]:slide-in-from-bottom">
        <DialogHeader className="border-b px-6 py-4 pr-12 text-left">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="px-6 py-5" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
          <Close value={() => setOpen(false)}>{children}</Close>
        </div>
      </DialogContent>
    </Dialog>
  );
}
