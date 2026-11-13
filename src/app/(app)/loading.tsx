// Shown the moment a link is tapped, while the server prepares the page, so a slow connection never feels frozen.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-8" aria-busy="true" aria-label="Loading">
      <div className="h-1 w-full overflow-hidden rounded-full bg-hairline">
        <div className="h-full w-1/3 animate-[loading_1.1s_ease-in-out_infinite] rounded-full bg-advance" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-8 w-64 max-w-full animate-pulse rounded-sm bg-slate-200" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-sm bg-slate-100" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card flex flex-col gap-3">
          <div className="h-5 w-48 animate-pulse rounded-sm bg-slate-200" />
          <div className="h-4 w-full animate-pulse rounded-sm bg-slate-100" />
          <div className="h-4 w-5/6 animate-pulse rounded-sm bg-slate-100" />
        </div>
      ))}
      <span className="sr-only" role="status">Loading…</span>
    </main>
  );
}
