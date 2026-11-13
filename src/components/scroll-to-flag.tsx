"use client";

import { useEffect } from "react";

/** After a failed submit, bring the first highlighted card into view and focus its first field. */
export function ScrollToFlag() {
  useEffect(() => {
    const card = document.querySelector<HTMLElement>("[data-missing=flag]");
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus({ preventScroll: true });
  }, []);
  return null;
}
