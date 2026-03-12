import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

function betaResponse() {
  return NextResponse.json({ status: 'beta', message: 'Coming soon' }, { status: 503 });
}

export async function GET(request: NextRequest) {
  if (process.env.BETA_MODE === 'true') return betaResponse();
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const res = await fetch(`${API_BASE}/api/escrow/stats`, {
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${session.apiKey}` },
    });
    if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}
