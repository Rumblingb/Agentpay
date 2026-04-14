import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${encodeURIComponent(workspaceId)}/connect-status`, {
      headers: { Authorization: `Bearer ${session.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[rcm/connect-status] upstream error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ connected: false, chargesEnabled: false, payoutsEnabled: false }, { status: 200 });
  }
}
