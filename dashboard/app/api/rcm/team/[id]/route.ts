import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await verifySession(req.cookies.get(COOKIE_NAME)?.value ?? '');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  try {
    const res = await fetch(`${API_BASE}/api/rcm/team/members/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch { return NextResponse.json({ error: 'Remove failed' }, { status: 502 }); }
}
