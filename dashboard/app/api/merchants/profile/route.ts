/**
 * BFF route: GET /api/merchants/profile
 *
 * Proxies /api/merchants/profile to the Express backend using the session
 * cookie's API key.  This route exists to prevent the Next.js fallback
 * rewrite in next.config.ts from forwarding unauthenticated browser requests
 * directly to the Render backend (which would always respond with 401).
 *
 * Equivalent to /api/me but at the path browsers and tools expect when they
 * follow the backend's documented endpoint structure.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { fetchProfile } from '@/lib/api';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySession(sessionCookie);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await fetchProfile(session.apiKey);
    return NextResponse.json(profile);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 502 });
  }
}
