import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const supabaseOrigins = supabase ? [supabase.origin, `${supabase.protocol === "https:" ? "wss" : "ws"}://${supabase.host}`] : [];

/**
 * Content Security Policy without nonces. Nonces need every page rendered per request, which
 * rules out the static shells `cacheComponents` prerenders, so inline scripts stay allowed
 * ('unsafe-inline'); everything else is locked to this origin and Supabase. React needs
 * 'unsafe-eval' only in development. The explorer's Web Worker is a same-origin module.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigins.join(" ")}`.trim(),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Only when the database is https too: local Supabase is plain http on 127.0.0.1.
  ...(supabase?.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Browsers ignore HSTS on plain-http localhost, so this is safe in development.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/:path*", headers: process.env.SITE_NOINDEX === "1" ? [...securityHeaders, ...noindex] : securityHeaders },
      // Signed-in and auth pages never belong in search results.
      ...["/app", "/app/:path*", "/login", "/auth/:path*", "/api/:path*"].map((source) => ({ source, headers: noindex })),
    ];
  },
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
