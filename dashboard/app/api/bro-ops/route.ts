import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function GET(req: NextRequest) {
  // Require an authenticated dashboard session
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = cookie ? await verifySession(cookie) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_SECRET_KEY not configured' }, { status: 503 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/bro-ops`, {
      headers: {
        'x-admin-key': adminKey,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch Bro ops data' }, { status: 500 });
  }
}
