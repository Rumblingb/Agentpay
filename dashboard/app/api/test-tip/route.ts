import { NextRequest, NextResponse } from 'next/server';

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
    // Attempt to call the backend simulate-tip endpoint if it is available.
    // Falls back to a client-side simulation so the tour works in all environments.
    const backendUrl = `${API_BASE}/api/test/simulate-tip`;
    const backendRes = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

/**
 * POST /api/test-tip
 * Proxies a simulated test tip to the backend (development / test mode only).
 * Returns a fake tip_received event so the onboarding tour can demo the flow.
 */
export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const amount: number = Number(body.amount) || 1.0;

    // Attempt to call the backend simulate-tip endpoint if it is available.
    // Falls back to a client-side simulation so the tour works in all environments.
    const backendUrl = `${API_BASE}/api/test/simulate-tip`;
    const backendRes = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify({ amount }),
    }).catch(() => null);

    if (backendRes && backendRes.ok) {
      const data = await backendRes.json();
      return NextResponse.json(data);
    }

    // Fallback: return a simulated response so the onboarding tour always works.
    const fee = parseFloat((amount * 0.05).toFixed(6));
    const botReceives = parseFloat((amount - fee).toFixed(6));
    return NextResponse.json({
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
