import { NextRequest, NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    await fetch(`${API_BASE}/api/merchants/recover/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: body.email }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // swallow — always return generic success (security: don't reveal if email exists)
  }

  return NextResponse.json({ ok: true });
}
