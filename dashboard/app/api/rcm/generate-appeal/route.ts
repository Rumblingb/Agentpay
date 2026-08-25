import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody } from '@/lib/requestBody';

export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  try {
    const res = await fetch(`${API_BASE}/api/rcm/generate-appeal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await res.json().catch(() => ({})) as { appeal?: string; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Failed to generate appeal' }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
  }
}
