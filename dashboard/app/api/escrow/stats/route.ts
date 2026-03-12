import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

function betaResponse() {
  return NextResponse.json(
    { status: 'beta', message: 'Coming soon' },
    { status: 503 }
  );
}

export async function GET(req: NextRequest) {
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

    const res = await fetch(`${API_BASE}/api/escrow/stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey ?? ''}`,
      },
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);

    return NextResponse.json(data, {
      status: res.status,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch escrow stats' },
      { status: 500 }
    );
  }
}
