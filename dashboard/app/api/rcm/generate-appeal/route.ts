import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { workItemId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.workItemId) {
    return NextResponse.json({ error: 'workItemId required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/rcm/generate-appeal`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workItemId: body.workItemId }),
    });
    const data = await res.json().catch(() => ({ error: 'Invalid response' }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: 'Failed to generate appeal' }, { status: 502 });
  }
}
