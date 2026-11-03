import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The AI routes read the BPIC demo snapshot and the demos' committed outputs from disk (lib/ai/target.ts, demoOutputs.ts).
  outputFileTracingIncludes: { "/api/ai/**": ["./public/demo/**/*", "./lib/ai/demo-outputs/**/*"] },
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
