/**
 * POST /api/rcm/workspaces/:workspaceId/demo-claim
 *
 * Seeds a single demonstrative claim into the workspace so a brand-new
 * practice can watch the agent work end-to-end without importing real PHI.
 * The edge handler creates a synthetic work item, queues a claim-status
 * check, and returns the work item id so the UI can deep-link the user
 * to the claims tab with that row highlighted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${encodeURIComponent(workspaceId)}/demo-claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[rcm/demo-claim] upstream error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not reach billing service.' }, { status: 503 });
  }
}
