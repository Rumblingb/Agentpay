import { NextRequest, NextResponse } from 'next/server';
import { signSession, COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function POST(req: NextRequest) {
  let body: { email?: string; recoveryToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, recoveryToken } = body;
  if (!email || !recoveryToken) {
    return NextResponse.json({ error: '"email" and "recoveryToken" are required' }, { status: 400 });
  }

  let backendRes: Response;
  try {
    backendRes = await fetch(`${API_BASE}/api/merchants/recover/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, recoveryToken }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return NextResponse.json({ error: 'Service unavailable. Please try again.' }, { status: 502 });
  }

  if (!backendRes.ok) {
    const data = await backendRes.json().catch(() => ({})) as { error?: string };
    return NextResponse.json({ error: data.error ?? 'Recovery failed.' }, { status: 400 });
  }

  const data = await backendRes.json() as { success?: boolean; apiKey?: string };
  if (!data.apiKey) {
    return NextResponse.json({ error: 'Unexpected response from backend.' }, { status: 502 });
  }

  const token = await signSession({ apiKey: data.apiKey, email });
  const cookieParts = [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `Max-Age=${SESSION_MAX_AGE}`,
    `SameSite=Lax`,
    `HttpOnly`,
  ];
  if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');

  return NextResponse.json({ success: true }, { status: 200, headers: { 'Set-Cookie': cookieParts.join('; ') } });
}
