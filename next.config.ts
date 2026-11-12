import type { NextConfig } from "next";

// Cache Components is off on purpose: every page in this internal app reads the
// session and live NCF data, so the request-time model is simpler and correct.
const nextConfig: NextConfig = {
  cacheComponents: false,
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
