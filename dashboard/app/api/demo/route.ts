import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

function betaResponse() {
  return NextResponse.json({ status: 'beta', message: 'Coming soon' }, { status: 503 });
}

export async function POST(request: NextRequest) {
  if (process.env.BETA_MODE === 'true') return betaResponse();
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const res = await fetch(`${API_BASE}/api/demo/run-agent-payment`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: 'Demo failed' }));
      return NextResponse.json(errData, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Demo payment failed' }, { status: 502 });
  }
}
