"use client";

import type { ReactNode } from "react";
import { ActionForm, type ActionState } from "./action-form";
import { useCloseModal } from "./modal";

/** An ActionForm inside a Modal: the modal closes and the form clears when the save succeeds. */
export function ModalForm({ action, children, className }: {
  action: (prev: ActionState, data: FormData) => Promise<ActionState>; children: ReactNode; className?: string;
}) {
  const close = useCloseModal();
  return <ActionForm action={action} onOk={close} resetOnOk className={className}>{children}</ActionForm>;
}
