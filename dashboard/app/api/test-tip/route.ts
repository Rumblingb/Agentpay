import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

function betaResponse() {
  return NextResponse.json(
    { status: 'beta', message: 'Coming soon' },
    { status: 503 }
  );
}

export async function POST(req: NextRequest) {
  if (process.env.BETA_MODE === 'true') {
    return betaResponse();
  }

  try {
    const cookie = req.cookies.get(COOKIE_NAME)?.value;
    const session = cookie ? await verifySession(cookie) : null;

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(body?.amount ?? 1);
    const fee = Number(body?.fee ?? 0);

    const res = await fetch(`${API_BASE}/api/test-tip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey ?? ''}`,
      },
      body: JSON.stringify({ amount, fee }),
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);

    return NextResponse.json(data, {
      status: res.status,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create test tip' },
      { status: 500 }
    );
  }
}
