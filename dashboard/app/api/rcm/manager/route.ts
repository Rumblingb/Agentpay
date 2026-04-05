import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import {
  fetchRcmClaimStatusExceptions,
  fetchRcmClaimStatusConnectors,
  fetchRcmClaimStatusWorkItems,
  fetchRcmOverview,
  fetchRcmWorkspaces,
} from '@/lib/api';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [overview, workspaces, workItems, exceptions, connectors] = await Promise.all([
      fetchRcmOverview(session.apiKey),
      fetchRcmWorkspaces(session.apiKey),
      fetchRcmClaimStatusWorkItems(session.apiKey, 8),
      fetchRcmClaimStatusExceptions(session.apiKey, 6),
      fetchRcmClaimStatusConnectors(session.apiKey),
    ]);

    return NextResponse.json({
      overview,
      workspaces,
      workItems,
      exceptions,
      connectors,
    });
  } catch (err: unknown) {
    console.error('[dashboard] rcm manager fetch error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to fetch RCM manager snapshot' }, { status: 502 });
  }
}
