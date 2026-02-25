import { NextRequest, NextResponse } from 'next/server';
import { verifySession, signSession, COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/session';
import { rotateApiKey } from '@/lib/api';

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await rotateApiKey(session.apiKey);
    // Refresh session with the new API key
    const newToken = await signSession({ apiKey: result.apiKey, email: session.email });
    const response = NextResponse.json({ success: true, apiKey: result.apiKey });
    response.cookies.set(COOKIE_NAME, newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Failed to rotate key' }, { status: 502 });
  }
}
