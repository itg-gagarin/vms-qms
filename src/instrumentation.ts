// Runs once when the server starts (Next.js instrumentation). Starts the background jobs on the Node.js server only.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
