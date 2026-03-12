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
    const cookieParts = [
      `${COOKIE_NAME}=${newToken}`,
      `Path=/`,
      `Max-Age=${SESSION_MAX_AGE}`,
      `SameSite=Lax`,
      `HttpOnly`,
    ];
    if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
    const setCookie = cookieParts.join('; ');

    return NextResponse.json({ success: true, apiKey: result.apiKey }, { status: 200, headers: { 'Set-Cookie': setCookie } });
  } catch {
    return NextResponse.json({ error: 'Failed to rotate key' }, { status: 502 });
  }
}
