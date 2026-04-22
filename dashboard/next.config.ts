import type { NextConfig } from "next";

const dashboardRoot = __dirname;

// AGENTPAY_API_BASE_URL is evaluated at build time by next.config.ts (server-only).
// Do NOT fall back to a NEXT_PUBLIC_ variable here — that would expose the backend
// origin URL in client-side bundles via the inlined rewrite destination.
const BACKEND_URL =
  process.env.AGENTPAY_API_BASE_URL ||
  "http://localhost:8787";

const nextConfig: NextConfig = {
  outputFileTracingRoot: dashboardRoot,
  turbopack: {
    root: dashboardRoot,
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      // Fallback rewrites apply only when no filesystem route (API route) matches.
      // This proxies unmatched /api/* requests to the Express backend, eliminating
      // CORS / CORB issues by keeping everything on the same origin.
      fallback: [
        {
          source: "/api/:path*",
          destination: `${BACKEND_URL}/api/:path*`,
        },
      ],
    };
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // CSP allows 'unsafe-eval' (required by Recharts `new Function()`)
            // and 'unsafe-inline' (required by Next.js hydration data scripts).
            // *.supabase.co allows Supabase auth/data connections from the browser.
            // *.vercel.app allows cross-app communication in Vercel preview environments.
            // *.workers.dev allows connections to the Cloudflare Workers backend.
            // *.supabase.co allows Supabase auth/data connections from the browser.
            // *.vercel.app allows cross-app communication in Vercel preview environments.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' *.supabase.co *.vercel.app",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' *.supabase.co *.workers.dev *.vercel.app",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
