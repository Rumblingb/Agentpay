import { NextRequest, NextResponse } from 'next/server';
import { signSession, COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import type { MerchantProfile } from '@/lib/api';

export async function POST(request: NextRequest) {
  try {
    const { email, apiKey } = await request.json();

    if (!email || !apiKey) {
      return NextResponse.json(
        { error: 'Email and API key are required' },
        { status: 400 },
      );
    }

    // Verify credentials against the backend.
    // We do the fetch inline here (rather than calling fetchProfile) so we can
    // inspect the response status and return a precise error to the caller:
    //   401 from backend → bad API key → show "Invalid credentials"
    //   any other error  → backend unreachable → show "Service unavailable"
    let profile: MerchantProfile;
    let backendRes: Response;
    try {
      backendRes = await fetch(`${API_BASE}/api/merchants/profile`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        // Render free-tier instances can take 30+ seconds to cold-start;
        // use 25 s so a slow wake-up doesn't produce a false "unreachable" error.
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      // Network error — backend is unreachable (Render cold-start, DNS, etc.)
      return NextResponse.json(
        { error: 'Service unavailable. The backend could not be reached. Please try again in a moment.' },
        { status: 502 },
      );
    }

    if (backendRes.status === 401) {
      return NextResponse.json(
        { error: 'Invalid credentials. Check your API key and make sure it was registered via POST /api/merchants/register.' },
        { status: 401 },
      );
    }

    if (!backendRes.ok) {
      return NextResponse.json(
        { error: `Backend returned an unexpected error (${backendRes.status}). Please try again.` },
        { status: 502 },
      );
    }

    try {
      profile = await backendRes.json();
    } catch {
      return NextResponse.json(
        { error: 'Unexpected response from the backend. Please try again.' },
        { status: 502 },
      );
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
