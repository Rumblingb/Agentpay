import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody } from '@/lib/requestBody';

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get(COOKIE_NAME)?.value ?? '');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  const { workspaceId, claims } = body;
  if (typeof workspaceId !== 'string' || workspaceId.length > 160 || !Array.isArray(claims) || claims.length > 500) {
    return NextResponse.json({ error: 'workspaceId and claims array required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${encodeURIComponent(String(workspaceId))}/import-claims`, {
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
