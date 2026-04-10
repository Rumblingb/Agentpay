import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const windowDays = request.nextUrl.searchParams.get('windowDays') ?? '30';

  try {
    const res = await fetch(`${API_BASE}/api/rcm/payer-intelligence?windowDays=${windowDays}`, {
      headers: { Authorization: `Bearer ${session.apiKey}` },
    });
    const data = await res.json().catch(() => ({ error: 'Invalid response' }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch payer intelligence' }, { status: 502 });
  }
}
