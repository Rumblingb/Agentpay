import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

function betaResponse() {
  return NextResponse.json({ status: 'beta', message: 'Coming soon' }, { status: 503 });
}

export async function POST(request: NextRequest) {
  if (process.env.BETA_MODE === 'true') {
    return betaResponse();
  }

  try {
    const cookie = request.cookies.get(COOKIE_NAME)?.value;
    const session = cookie ? await verifySession(cookie) : null;

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const res = await fetch(`${API_BASE}/api/demo/run-agent-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey ?? ''}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);

    return NextResponse.json(data, {
      status: res.status,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create demo payment' },
      { status: 500 }
    );
  }
}
