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

  // Send welcome email with the API key so the customer can sign back in after session expiry.
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'Ace Billing <notifications@agentpay.so>',
        to: [email],
        subject: 'Welcome to Ace — save your access key',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#000;font-family:Inter,system-ui,sans-serif;color:#f8fafc;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding-bottom:24px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#10b981,#059669);text-align:center;vertical-align:middle;">
            <span style="font-size:16px;color:#000;">&#x2666;</span>
          </td>
          <td style="padding-left:10px;font-size:17px;font-weight:700;letter-spacing:-0.03em;color:#f8fafc;">Ace</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding-bottom:12px;">
        <h1 style="margin:0;font-size:26px;font-weight:800;letter-spacing:-0.03em;color:#f8fafc;">Welcome to Ace Billing</h1>
      </td></tr>
      <tr><td style="padding-bottom:24px;">
        <p style="margin:0;font-size:15px;color:#94a3b8;line-height:1.6;">You&rsquo;re set up. Here&rsquo;s your access key &mdash; save it somewhere safe. You&rsquo;ll need it to sign in.</p>
      </td></tr>
      <tr><td style="padding-bottom:8px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Your access key</p>
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;">
          <code style="font-family:ui-monospace,monospace;font-size:13px;color:#4ade80;word-break:break-all;">${apiKey}</code>
        </div>
      </td></tr>
      <tr><td style="padding-bottom:32px;">
        <p style="margin:8px 0 0;font-size:13px;color:#64748b;line-height:1.5;">To sign in: go to <strong style="color:#94a3b8;">app.agentpay.so/rcm-login</strong> and enter your email and this key.</p>
      </td></tr>
      <tr><td style="padding-bottom:40px;">
        <a href="https://app.agentpay.so/rcm" style="display:inline-block;background:#4ade80;color:#000;font-size:14px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:12px;letter-spacing:-0.01em;">Go to your dashboard &rarr;</a>
      </td></tr>
      <tr><td>
        <p style="margin:0;font-size:12px;color:#334155;line-height:1.5;">Ace Billing &middot; AgentPay &middot; If you didn&rsquo;t sign up, ignore this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
      }),
    }).catch((err: unknown) => {
      console.warn('[rcm-signup] Resend email failed:', err);
    });
  } else {
    console.warn('[rcm-signup] RESEND_API_KEY not set — welcome email not sent');
  }

  return NextResponse.json(
    { success: true },
    { status: 201, headers: { 'Set-Cookie': cookieParts.join('; ') } },
  );
}
