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
    const amount: number = Number(body.amount) || 1.0;
    const backendUrl = `${API_BASE}/api/test/simulate-tip`;
    const backendRes = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify({ amount }),
    }).catch(() => null);
    let data = null;
    if (backendRes && backendRes.ok) {
      data = await backendRes.json();
    } else {
      data = { tip_received: true, amount };
    }
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
      success: true,
      event: 'tip_received',
      tipId: `test-tip-${Date.now()}`,
      amount,
      fee,
      botReceives,
      currency: 'USDC',
      timestamp: new Date().toISOString(),
      note: 'Simulated test tip. Switch to production to receive real payments.',
    });
  } catch {
    return NextResponse.json({ error: 'Failed to simulate tip' }, { status: 500 });
  }
}
