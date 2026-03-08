/**
 * BFF route: GET /api/escrow/stats
 *
 * Wraps the Express /api/escrow/stats endpoint with dashboard session
 * verification so only authenticated users can read escrow aggregates.
 *
 * Without this route the request would fall through to the Next.js fallback
 * rewrite (next.config.ts) which proxies unauthenticated /api/* traffic
 * straight to the Express backend — bypassing the cookie-based session check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/escrow/stats`, {
      headers: {
        Authorization: `Bearer ${session.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch escrow stats' },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[BFF /api/escrow/stats] upstream fetch failed:', err);
    return NextResponse.json(
      { error: 'Failed to fetch escrow stats' },
      { status: 502 },
    );
  }
}
