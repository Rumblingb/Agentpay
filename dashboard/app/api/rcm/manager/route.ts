import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import {
  fetchRcmClaimStatusExceptions,
  fetchRcmClaimStatusConnectors,
  fetchRcmClaimStatusWorkItems,
  fetchRcmEligibilityConnectors,
  fetchRcmEligibilityExceptions,
  fetchRcmEligibilityWorkItems,
  fetchRcmOverview,
  fetchRcmWorkspaces,
} from '@/lib/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [
      overview,
      workspaces,
      claimStatusWorkItems,
      claimStatusExceptions,
      claimStatusConnectors,
      eligibilityWorkItems,
      eligibilityExceptions,
      eligibilityConnectors,
    ] = await Promise.all([
      fetchRcmOverview(session.apiKey),
      fetchRcmWorkspaces(session.apiKey),
      fetchRcmClaimStatusWorkItems(session.apiKey, 8),
      fetchRcmClaimStatusExceptions(session.apiKey, 6),
      fetchRcmClaimStatusConnectors(session.apiKey),
      fetchRcmEligibilityWorkItems(session.apiKey, 8),
      fetchRcmEligibilityExceptions(session.apiKey, 6),
      fetchRcmEligibilityConnectors(session.apiKey),
    ]);

    return NextResponse.json({
      overview,
      workspaces,
      // Claim status lane
      workItems: claimStatusWorkItems,
      exceptions: claimStatusExceptions,
      connectors: claimStatusConnectors,
      // Eligibility lane
      eligibilityWorkItems,
      eligibilityExceptions,
      eligibilityConnectors,
    });
  } catch (err: unknown) {
    console.error('[dashboard] rcm manager fetch error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to fetch RCM manager snapshot' }, { status: 502 });
  }
}
