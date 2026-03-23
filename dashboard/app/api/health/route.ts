/**
 * BFF route: GET /api/health
 *
 * Proxies the Workers /health endpoint so the dashboard can check
 * whether the production API is reachable before attempting login.
 * No authentication required — this is intentionally public.
 *
 * Response mirrors the backend shape:
 *   { status: "active"|"degraded", services: { database: {...}, ... } }
 *
 * The login page can call /api/health before submitting credentials; if the
 * backend is cold-starting on Render (free tier) the user gets a clear
 * "Service waking up" message rather than a confusing 401.
 */
import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json();
    // Forward the exact status code from the backend (200 = healthy, 503 = degraded)
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        status: 'unreachable',
        message: 'The AgentPay API could not be reached. Check the Workers deployment URL and try again.',
      },
      { status: 503 },
    );
  }
}
