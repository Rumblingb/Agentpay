import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get(COOKIE_NAME)?.value ?? '');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { workspaceId, claims } = body;
  if (!workspaceId || !Array.isArray(claims)) {
    return NextResponse.json({ error: 'workspaceId and claims array required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${String(workspaceId)}/import-claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.apiKey}` },
      body: JSON.stringify({ claims }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Import failed' }, { status: 502 });
  }
}
