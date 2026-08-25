import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody } from '@/lib/requestBody';

export async function POST(request: NextRequest) {
  if (process.env.BETA_MODE === 'true') {
    return NextResponse.json({ status: 'beta', message: 'Coming soon' }, { status: 503 });
  }

  try {
    const cookie = request.cookies.get(COOKIE_NAME)?.value;
    const session = cookie ? await verifySession(cookie) : null;

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = await readJsonBody<Record<string, unknown>>(request);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const body = parsed.value;

    const res = await fetch(`${API_BASE}/api/demo/spawn-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey ?? ''}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);

    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to spawn agent', detail: String(err) }, { status: 500 });
  }
}
