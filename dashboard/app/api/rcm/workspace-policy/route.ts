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

export async function PATCH(req: NextRequest) {
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { workspaceId?: string; approvalPolicy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { workspaceId, approvalPolicy } = body;
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${workspaceId}`, {
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
