import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const windowDays = new URL(req.url).searchParams.get('windowDays') ?? '30';

  try {
    const res = await fetch(
      `${API_BASE}/api/rcm/payer-intelligence?windowDays=${encodeURIComponent(windowDays)}`,
      {
        headers: { Authorization: `Bearer ${session.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      return NextResponse.json({ payers: [], error: d.error ?? 'Failed to load payer intelligence' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'max-age=900' },
    });
  } catch {
    return NextResponse.json({ payers: [] });
  }
}
