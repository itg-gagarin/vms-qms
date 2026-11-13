"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

/** A page that failed to load: say so plainly and offer to reload. */
export function ErrorView({ error, retry }: { error: unknown; retry: () => void }) {
  // A tab opened before an update calls actions the new server no longer has; reloading the page fixes it.
  const stale = error instanceof Error && /Server Action|deployment|ChunkLoadError|Loading chunk/i.test(error.message);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-md border border-hairline bg-white p-6 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-50 text-status-amber">
          <TriangleAlert size={22} aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-[18px] font-semibold text-ink">
          {stale ? "The system was just updated" : "This page could not load"}
        </h1>
        <p className="mt-1 text-[14px] text-muted">
          {stale ? "Reload to continue with the new version. Nothing you saved is lost." : "Try again. If it keeps happening, tell the PMO administrator."}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => (stale ? window.location.reload() : retry())} className="btn btn-commit">
            <RefreshCw size={16} aria-hidden="true" /> {stale ? "Reload" : "Try again"}
          </button>
          {/* A full page load on purpose: it fetches the current version's files. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/ncf" className="btn">Go to NCF list</a>
        </div>
      </div>
    </main>
  );
}
