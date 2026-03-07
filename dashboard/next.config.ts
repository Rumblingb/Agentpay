import type { NextConfig } from "next";

const BACKEND_URL =
  process.env.AGENTPAY_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001";

const nextConfig: NextConfig = {
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
            // This is a net improvement over the previous state (no CSP at all).
            // TODO: Migrate to nonce-based CSP when Next.js experimental
            //       `contentSecurityPolicy` config is stable.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self'",
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
