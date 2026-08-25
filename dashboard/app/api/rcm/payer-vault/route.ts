import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody } from '@/lib/requestBody';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${encodeURIComponent(workspaceId)}/credentials`, {
      headers: { Authorization: `Bearer ${session.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ credentials: [] });
  }
}

export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  const { workspaceId, ...rest } = body;
  if (typeof workspaceId !== 'string' || workspaceId.length > 160) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${encodeURIComponent(workspaceId as string)}/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify(rest),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 502 });
  }
}
