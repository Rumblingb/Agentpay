import { NextRequest, NextResponse } from 'next/server';
import { signSession, COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import type { MerchantProfile } from '@/lib/api';
import { readJsonBody, isValidEmail, hasControlCharacters } from '@/lib/requestBody';
import { enforceBurstLimit } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  try {
    const limited = enforceBurstLimit(request, 'auth-login');
    if (limited) return limited;

    const parsed = await readJsonBody<{ email?: unknown; apiKey?: unknown }>(request);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { email: rawEmail, apiKey: rawApiKey } = parsed.value;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';

    if (!email || !apiKey || !isValidEmail(email) || apiKey.length > 256 || hasControlCharacters(apiKey)) {
      return NextResponse.json(
        { error: 'A valid email and access key are required' },
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
        { error: 'Invalid email or access key. Check the welcome email from notifications@agentpay.so for your access key.' },
        { status: 401 },
      );
    }

    if (!backendRes.ok) {
      return NextResponse.json(
        { error: 'Sign-in failed. Please try again in a moment.' },
        { status: 502 },
      );
    }

    try {
      profile = await backendRes.json();
    } catch {
      return NextResponse.json(
        { error: 'Sign-in failed. Please try again in a moment.' },
        { status: 502 },
      );
    }

    // Confirm the email matches
    if (profile.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Sign the session cookie
    const token = await signSession({ apiKey, email: profile.email });

    // Build a Set-Cookie header manually so TypeScript doesn't depend on NextResponse.cookies
    const cookieParts = [
      `${COOKIE_NAME}=${token}`,
      `Path=/`,
      `Max-Age=${SESSION_MAX_AGE}`,
      `SameSite=Lax`,
      `HttpOnly`,
    ];
    if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
    const setCookie = cookieParts.join('; ');

    return NextResponse.json({ success: true }, { status: 200, headers: { 'Set-Cookie': setCookie } });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
