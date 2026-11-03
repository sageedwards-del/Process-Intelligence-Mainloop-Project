import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The AI routes read the BPIC demo snapshot from disk (lib/ai/target.ts).
  outputFileTracingIncludes: { "/api/ai/**": ["./public/demo/**/*"] },
  partialPrefetching: true,
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
