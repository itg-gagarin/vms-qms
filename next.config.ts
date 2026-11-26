import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Version skew: a browser tab opened before a deploy still runs the old JavaScript, and its buttons call Server
// Actions the new server no longer has ("Failed to find Server Action", shown as "This page couldn't load").
// With a deploymentId, Next.js notices the mismatch and reloads the page instead. The id must be the same at build
// time and at runtime, so the Docker build writes it to .deployment-id and both read it from there.
function deploymentId() {
  try {
    return readFileSync(".deployment-id", "utf8").trim() || undefined;
  } catch {
    return undefined; // development: no skew to protect against
  }
}

// Cache Components is off on purpose: every page in this internal app reads the
// session and live NCF data, so the request-time model is simpler and correct.
const nextConfig: NextConfig = {
  cacheComponents: false,
  deploymentId: deploymentId(),
  serverExternalPackages: ["pg"],
  // Evidence photos and videos are uploaded through Server Actions (video limit 50 MB).
  experimental: {
    serverActions: { bodySizeLimit: "60mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
