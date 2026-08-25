import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody } from '@/lib/requestBody';

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${API_BASE}/api/merchants/webhooks`, {
      headers: authHeaders(session.apiKey),
    });
    if (!res.ok) {
      // Return empty list if the endpoint doesn't exist yet
      return NextResponse.json({ webhooks: [], deliveries: [] });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ webhooks: [], deliveries: [] });
  }
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await readJsonBody<Record<string, unknown>>(request);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (typeof body.url !== 'string' || body.url.length > 2048 || !body.url.startsWith('https://')) {
    return NextResponse.json({ error: 'Webhook URL must use HTTPS' }, { status: 400 });
  }
  if (body.events !== undefined && (!Array.isArray(body.events) || body.events.length > 50 || body.events.some((event) => typeof event !== 'string' || event.length > 120))) {
    return NextResponse.json({ error: 'Invalid webhook events' }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/merchants/webhooks`, {
      method: 'POST',
      headers: authHeaders(session.apiKey),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 502 });
  }
}
