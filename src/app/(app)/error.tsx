"use client";

import { ErrorView } from "@/components/error-view";

// Errors inside the app keep the sidebar and top bar; only the page area shows the message.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
