import { NextRequest, NextResponse } from 'next/server';
import { signSession, COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody, isValidEmail, hasControlCharacters } from '@/lib/requestBody';
import { enforceBurstLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const limited = enforceBurstLimit(req, 'rcm-recover-confirm');
  if (limited) return limited;
  const parsed = await readJsonBody<{ email?: unknown; recoveryToken?: unknown }>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const recoveryToken = typeof body.recoveryToken === 'string' ? body.recoveryToken.trim() : '';
  if (!isValidEmail(email) || !recoveryToken || recoveryToken.length > 512 || hasControlCharacters(recoveryToken)) {
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
