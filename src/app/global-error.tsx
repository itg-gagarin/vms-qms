"use client";

import { ErrorView } from "@/components/error-view";
import "./globals.css";

// Replaces the root layout when even that fails; it brings its own html and body.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="id">
      <body className="min-h-full bg-page text-ink">
        <ErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}
