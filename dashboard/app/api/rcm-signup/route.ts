/**
 * POST /api/rcm-signup
 *
 * Self-serve registration for RCM billing managers.
 * Creates a merchant account on the backend (no wallet/Solana knowledge needed —
 * we auto-generate a placeholder wallet reference for RCM users).
 * Sets the session cookie so the user lands directly on /rcm-onboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { signSession, COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/session';
import { API_BASE } from '@/lib/api';

function generateRcmWalletRef(): string {
  // 40-char placeholder (32–44 allowed by backend). Not a real Solana key —
  // RCM users settle via Stripe, not USDC. Prefix makes them easy to identify.
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return 'rcm' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = (body.password ?? '').trim();

  if (!name || name.length < 2) return NextResponse.json({ error: 'Practice name is required.' }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
  if (!password || password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });

  // Register a merchant account on the backend.
  // The backend stores a PBKDF2-hashed API key — we treat that key as the password
  // proxy so billing managers never see raw API keys.
  let registerRes: Response;
  try {
    registerRes = await fetch(`${API_BASE}/api/merchants/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        walletAddress: generateRcmWalletRef(),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return NextResponse.json({ error: 'Service unavailable. Please try again in a moment.' }, { status: 502 });
  }

  if (registerRes.status === 400) {
    const data = await registerRes.json().catch(() => ({})) as { error?: string };
    const msg = data.error ?? 'Registration failed.';
    // Friendly message for duplicate email
    if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'That email is already registered. Sign in instead.' }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!registerRes.ok) {
    return NextResponse.json({ error: `Backend error (${registerRes.status}). Please try again.` }, { status: 502 });
  }

  const data = await registerRes.json() as { apiKey?: string; merchantId?: string };
  const apiKey = data.apiKey;
  if (!apiKey) {
    return NextResponse.json({ error: 'Unexpected response from backend.' }, { status: 502 });
  }

  // Sign the session cookie (same format as the regular login)
  const token = await signSession({ apiKey, email });
  const cookieParts = [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `Max-Age=${SESSION_MAX_AGE}`,
    `SameSite=Lax`,
    `HttpOnly`,
  ];
  if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');

  return NextResponse.json(
    { success: true },
    { status: 201, headers: { 'Set-Cookie': cookieParts.join('; ') } },
  );
}
