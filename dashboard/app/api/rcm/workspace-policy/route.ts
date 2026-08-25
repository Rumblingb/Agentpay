/**
 * PATCH /api/rcm/workspace-policy
 *
 * Persists the approval policy for an RCM workspace.
 * Proxies to the backend PATCH /api/rcm/workspaces/:id.
 * Returns { ok: true } immediately if the backend route isn't wired yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody } from '@/lib/requestBody';

export async function PATCH(req: NextRequest) {
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await readJsonBody<{ workspaceId?: unknown; approvalPolicy?: unknown }>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  const { workspaceId, approvalPolicy } = body;
  if (typeof workspaceId !== 'string' || workspaceId.length > 160 || !approvalPolicy || typeof approvalPolicy !== 'object') return NextResponse.json({ error: 'workspaceId and approvalPolicy required' }, { status: 400 });

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify({ approvalPolicy }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok && res.status !== 404) {
      const d = await res.json().catch(() => ({})) as { error?: string };
      return NextResponse.json({ error: d.error ?? 'Failed to update policy' }, { status: res.status });
    }

    return NextResponse.json({ ok: true });
  } catch {
    // Non-fatal — policy is already stored in localStorage on the client
    return NextResponse.json({ ok: true, note: 'backend_unavailable' });
  }
}
