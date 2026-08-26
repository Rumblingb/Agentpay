import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { fetchPayments } from '@/lib/api';

function parsePageParam(value: string | null, fallback: number, max: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = parsePageParam(searchParams.get('limit'), 50, 100);
  const offset = parsePageParam(searchParams.get('offset'), 0, 100_000);
  if (limit === null || offset === null || limit < 1) {
    return NextResponse.json({ error: 'Invalid pagination' }, { status: 400 });
  }

  try {
    const data = await fetchPayments(session.apiKey, limit, offset);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 502 });
  }
}
