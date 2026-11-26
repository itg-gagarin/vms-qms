"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Phones only: the screen's one advance action, pinned to the bottom so it is in reach while reading the form.
 * It jumps to the panel that does the work (`target`, an element id) and hides while that panel is on screen,
 * so there is never more than one green button in view.
 */
export function PhoneActionBar({ href, label }: { href: string; label: string }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const id = href.startsWith("#") ? href.slice(1) : null;
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [href]);
  return (
    <>
      <div aria-hidden="true" className="h-14 md:hidden" />
      {/* Floats just above the phone navigation bar (see components/shell/app-shell.tsx, MobileNav) */}
      <div className={`fixed inset-x-3 z-30 transition-[opacity,transform] duration-200 md:hidden ${hidden ? "pointer-events-none translate-y-4 opacity-0" : ""}`}
        style={{ bottom: "calc(max(12px, env(safe-area-inset-bottom)) + 72px)" }}>
        <Link href={href} className="btn btn-advance h-12 w-full justify-center rounded-xl text-sm shadow-lg" tabIndex={hidden ? -1 : undefined}>{label}</Link>
      </div>
    </>
  );
}
