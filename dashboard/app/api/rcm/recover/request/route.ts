import { NextRequest, NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';
import { readJsonBody, isValidEmail } from '@/lib/requestBody';
import { enforceBurstLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const limited = enforceBurstLimit(req, 'rcm-recover-request');
  if (limited) return limited;
  const parsed = await readJsonBody<{ email?: unknown }>(req);
  if (!parsed.ok) return NextResponse.json({ ok: true });
  const email = typeof parsed.value.email === 'string' ? parsed.value.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return NextResponse.json({ ok: true });

  try {
    await fetch(`${API_BASE}/api/merchants/recover/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // swallow — always return generic success (security: don't reveal if email exists)
  }

  return NextResponse.json({ ok: true });
}
