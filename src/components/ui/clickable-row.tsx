"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A table row that opens `href` when clicked anywhere. Keep a real <Link> in the row (usually the record number)
 * for keyboard and screen-reader users; clicks on links, buttons and form fields inside the row keep their own action.
 */
export function ClickableRow({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
        if (window.getSelection()?.toString()) return; // let people select text without navigating
        router.push(href);
      }}
      className={`cursor-pointer hover:bg-row-hover ${className}`}
    >
      {children}
    </tr>
  );
}
