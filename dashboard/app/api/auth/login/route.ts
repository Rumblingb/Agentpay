import { NextRequest, NextResponse } from 'next/server';
import { signSession, COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/session';
import { fetchProfile } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    const { email, apiKey } = await request.json();

    if (!email || !apiKey) {
      return NextResponse.json(
        { error: 'Email and API key are required' },
        { status: 400 },
      );
    }

    // Verify credentials against the backend
    let profile;
    try {
      profile = await fetchProfile(apiKey);
    } catch {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Confirm the email matches
    if (profile.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Sign the session cookie
    const token = await signSession({ apiKey, email: profile.email });

    const response = NextResponse.json({ success: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
