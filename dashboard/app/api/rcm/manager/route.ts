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

type PanelState = 'ok' | 'error';

const emptyOverview = {
  stage: 'degraded',
  queue: {
    totalWorkItems: 0,
    totalOpen: 0,
    autoClosedCount: 0,
    humanClosedCount: 0,
    blockedCount: 0,
    rejectedCount: 0,
    humanReviewCount: 0,
    openExceptionCount: 0,
    highSeverityExceptionCount: 0,
    amountAtRiskOpen: 0,
    avgConfidencePct: null,
    autoClosedPct: 0,
    humanInterventionPct: 0,
  },
  workspaces: {
    count: 0,
  },
  firstLane: {
    key: 'institutional_claim_status',
    label: 'Claim status',
    reason: 'Primary operational lane is temporarily unavailable.',
    totalItems: 0,
    openItems: 0,
    openExceptions: 0,
  },
};

const emptyCollection = {
  count: 0,
  items: [],
};

const emptyConnectorCollection = {
  connectors: [],
};

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const results = await Promise.allSettled([
      fetchRcmOverview(session.apiKey),
      fetchRcmWorkspaces(session.apiKey),
      fetchRcmClaimStatusWorkItems(session.apiKey, 8),
      fetchRcmClaimStatusExceptions(session.apiKey, 6),
      fetchRcmClaimStatusConnectors(session.apiKey),
      fetchRcmEligibilityWorkItems(session.apiKey, 8),
      fetchRcmEligibilityExceptions(session.apiKey, 6),
      fetchRcmEligibilityConnectors(session.apiKey),
    ]);

    const warnings: string[] = [];
    const panelStatus: Record<string, PanelState> = {};

    function settle<T>(result: PromiseSettledResult<T>, panelKey: string, label: string, fallback: T): T {
      if (result.status === 'fulfilled') {
        panelStatus[panelKey] = 'ok';
        return result.value;
      }

      panelStatus[panelKey] = 'error';
      warnings.push(label);
      console.error(
        `[dashboard] rcm manager panel error (${panelKey}):`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      );
      return fallback;
    }

    const overview = settle(results[0], 'overview', 'Overview metrics unavailable', emptyOverview);
    const workspaces = settle(results[1], 'workspaces', 'Workspace roster unavailable', emptyCollection);
    const claimStatusWorkItems = settle(results[2], 'claimStatusWorkItems', 'Claim-status queue unavailable', emptyCollection);
    const claimStatusExceptions = settle(results[3], 'claimStatusExceptions', 'Claim-status exceptions unavailable', emptyCollection);
    const claimStatusConnectors = settle(results[4], 'claimStatusConnectors', 'Claim-status connectors unavailable', emptyConnectorCollection);
    const eligibilityWorkItems = settle(results[5], 'eligibilityWorkItems', 'Eligibility queue unavailable', emptyCollection);
    const eligibilityExceptions = settle(results[6], 'eligibilityExceptions', 'Eligibility exceptions unavailable', emptyCollection);
    const eligibilityConnectors = settle(results[7], 'eligibilityConnectors', 'Eligibility connectors unavailable', emptyConnectorCollection);

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
      partial: warnings.length > 0,
      warnings,
      panelStatus,
    });
  } catch (err: unknown) {
    console.error('[dashboard] rcm manager fetch error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to fetch RCM manager snapshot' }, { status: 502 });
  }
}
