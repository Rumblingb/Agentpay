/**
 * Security response headers middleware.
 *
 * Provides the same baseline security headers that Helmet gives in the Express
 * backend (with the same CSP, COEP, and CORP disabled intentionally — see
 * comment in src/server.ts Helmet config for rationale).
 *
 * Headers set:
 *   X-Content-Type-Options: nosniff          — prevent MIME sniffing
 *   X-Frame-Options: DENY                    — prevent clickjacking
 *   Referrer-Policy: strict-origin-when-cross-origin
 *   X-XSS-Protection: 0                      — modern browsers ignore this;
 *                                              explicitly disabling the legacy
 *                                              IE XSS filter avoids mode=block
 *                                              vulnerabilities
 *
 * NOT set (intentionally, matching Express Helmet config):
 *   Content-Security-Policy                  — API-only; no HTML served
 *   Cross-Origin-Embedder-Policy             — causes COEP require-corp issues
 *                                              when proxied through Vercel
 *   Cross-Origin-Resource-Policy             — same reasoning as COEP
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types';

export async function securityHeadersMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<void | Response> {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-XSS-Protection', '0');
}
