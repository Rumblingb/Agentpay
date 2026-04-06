/**
 * POST /api/partner
 *
 * Operator / partner intake form submission.
 * Emails the AgentPay team (ADMIN_EMAIL) and sends a confirmation to the submitter.
 * No auth required — public form endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? 'hello@agentpay.so';
const FROM_EMAIL     = 'Ace at AgentPay <ace@agentpay.so>';

interface PartnerSubmission {
  name: string;
  company: string;
  email: string;
  volume: string;   // trips/month range
  useCase: string;  // embed | white_label | api | other
  message?: string;
}

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
  let body: PartnerSubmission;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, company, email, volume, useCase, message } = body;

  if (!name?.trim() || !email?.trim() || !company?.trim()) {
    return NextResponse.json({ error: 'name, company, and email are required' }, { status: 400 });
  }

  const useCaseLabel: Record<string, string> = {
    embed:       'Embed Ace into their product',
    white_label: 'White-label Ace for their clients',
    api:         'API integration (build on top)',
    other:       'Other / not sure yet',
  };

  // Email to admin
  const adminHtml = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 16px">New operator inquiry — AgentPay Partner</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px 0;color:#555;width:140px">Name</td><td style="padding:8px 0;font-weight:600">${name}</td></tr>
        <tr><td style="padding:8px 0;color:#555">Company</td><td style="padding:8px 0;font-weight:600">${company}</td></tr>
        <tr><td style="padding:8px 0;color:#555">Email</td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
        <tr><td style="padding:8px 0;color:#555">Volume</td><td style="padding:8px 0">${volume ?? '—'} trips/month</td></tr>
        <tr><td style="padding:8px 0;color:#555">Use case</td><td style="padding:8px 0">${useCaseLabel[useCase] ?? useCase ?? '—'}</td></tr>
        ${message ? `<tr><td style="padding:8px 0;color:#555;vertical-align:top">Notes</td><td style="padding:8px 0">${message}</td></tr>` : ''}
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#888">Submitted via agentpay.so/partner</p>
    </div>
  `;

  // Confirmation to submitter
  const confirmHtml = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#080808;color:#f8fafc;padding:40px 32px;border-radius:16px">
      <div style="font-size:28px;font-weight:900;letter-spacing:-0.5px;margin-bottom:8px">ACE</div>
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;color:#f8fafc">We got your message, ${name.split(' ')[0]}.</h2>
      <p style="color:#94a3b8;line-height:1.6;margin:0 0 24px">
        Thanks for reaching out about integrating Ace. We review every operator inquiry personally — expect a reply within 24 hours.
      </p>
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:24px">
        <div style="font-size:12px;color:#64748b;margin-bottom:12px;letter-spacing:0.5px">YOUR SUBMISSION</div>
        <div style="color:#f8fafc;margin-bottom:6px"><span style="color:#64748b">Company:</span> ${company}</div>
        <div style="color:#f8fafc;margin-bottom:6px"><span style="color:#64748b">Volume:</span> ${volume ?? '—'} trips/month</div>
        <div style="color:#f8fafc"><span style="color:#64748b">Looking for:</span> ${useCaseLabel[useCase] ?? useCase ?? '—'}</div>
      </div>
      <p style="color:#64748b;font-size:13px;margin:0">
        While you wait — the Ace app is live on TestFlight if you want to see what your customers would experience.<br>
        <a href="https://agentpay.gg/join" style="color:#4ade80">agentpay.gg/join</a>
      </p>
    </div>
  `;

  try {
    await Promise.all([
      sendEmail(ADMIN_EMAIL, `Partner inquiry: ${company} — ${name}`, adminHtml),
      sendEmail(email.trim(), 'Ace will be in touch — AgentPay Partner', confirmHtml),
    ]);
  } catch {
    // Don't fail the request if email fails — log and continue
    console.error('[partner] email send failed');
  }

  return NextResponse.json({ ok: true });
}
