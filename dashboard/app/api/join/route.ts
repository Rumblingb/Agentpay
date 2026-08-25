/**
 * POST /api/join
 *
 * DTC waitlist / early access signup.
 * Emails the AgentPay team + sends a welcome confirmation to the user.
 * No auth required — public.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, isValidEmail, hasControlCharacters, escapeHtml } from '@/lib/requestBody';
import { enforceBurstLimit } from '@/lib/rateLimit';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? 'hello@agentpay.so';
const FROM_EMAIL     = 'Ace at AgentPay <ace@agentpay.so>';

// TestFlight invite link — update when the build is live
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/agentpay';

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
}

export async function POST(req: NextRequest) {
  const limited = enforceBurstLimit(req, 'join');
  if (limited) return limited;
  const parsed = await readJsonBody<{ email?: unknown; name?: unknown }>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  if (name.length > 120 || hasControlCharacters(name)) return NextResponse.json({ error: 'name is invalid' }, { status: 400 });

  const firstName = (name ?? '').split(' ')[0] || 'there';
  const safeEmail = escapeHtml(email);
  const safeName = escapeHtml(name);
  const safeFirstName = escapeHtml(firstName);

  const adminHtml = `
    <div style="font-family:system-ui,sans-serif;color:#111">
      <h2>New Ace signup</h2>
      <p><strong>Email:</strong> ${safeEmail}</p>
      ${name ? `<p><strong>Name:</strong> ${safeName}</p>` : ''}
      <p style="font-size:12px;color:#888">via agentpay.gg/join</p>
    </div>
  `;

  const welcomeHtml = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#080808;color:#f8fafc;padding:48px 32px;border-radius:16px">
      <div style="font-size:30px;font-weight:900;letter-spacing:-0.5px;margin-bottom:16px">ACE</div>

      <h1 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#f8fafc;line-height:1.2">
        Hey ${safeFirstName} — Ace is ready.
      </h1>
      <p style="color:#94a3b8;line-height:1.6;margin:0 0 32px">
        Say the trip once. Ace handles the route, the booking, and the delivery. No tabs, no forms, no service fee in April.
      </p>

      <a href="${TESTFLIGHT_URL}" style="display:inline-block;background:#f8fafc;color:#080808;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:32px">
        Open in TestFlight →
      </a>

      <div style="border-top:1px solid #1e293b;padding-top:24px;margin-top:8px">
        <p style="color:#94a3b8;font-size:14px;margin:0 0 8px">A few things to know:</p>
        <ul style="color:#64748b;font-size:13px;line-height:1.8;padding-left:20px;margin:0">
          <li>UK and India rail are live today</li>
          <li>Say the trip naturally — Ace understands accents and station names</li>
          <li>You approve before anything is charged</li>
          <li>No service fee until May</li>
        </ul>
      </div>

      <p style="color:#334155;font-size:12px;margin-top:32px 0 0">
        Questions? Reply to this email — it comes straight to us.
      </p>
    </div>
  `;

  try {
    await Promise.all([
      sendEmail(ADMIN_EMAIL, `New Ace signup: ${email}`, adminHtml),
      sendEmail(email.trim(), 'Ace is ready for you', welcomeHtml),
    ]);
  } catch {
    console.error('[join] email send failed');
  }

  return NextResponse.json({ ok: true, testflightUrl: TESTFLIGHT_URL });
}
