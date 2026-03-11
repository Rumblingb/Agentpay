/**
 * AgentPay API — Cloudflare Workers entrypoint (Phase 2 scaffold)
 *
 * This is the Hono application that will replace the Render/Express backend
 * for all public HTTP routes.
 *
 * Current state (Phase 2):
 *   - App compiles and starts.
 *   - No routes yet — all requests return Hono's default 404.
 *   - Routes, middleware, and DB access are added in subsequent phases.
 *
 * Architecture:
 *   Hono<{ Bindings: Env }> types the second argument of every handler as
 *   `c.env`, giving full TypeScript coverage over Workers bindings (secrets,
 *   vars, Hyperdrive) without any process.env usage.
 */

import { Hono } from 'hono';
import type { Env } from './types';

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Export — required by the Workers runtime.
// The `fetch` export is the single entry point for all incoming HTTP requests.
// ---------------------------------------------------------------------------

export default app;
