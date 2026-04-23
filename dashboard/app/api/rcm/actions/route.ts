import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

type Lane = 'claim-status' | 'eligibility';
type Operation =
  | 'run-primary'
  | 'run-fallback'
  | 'approve-qa'
  | 'escalate-qa'
  | 'take-over'
  | 'mark-blocked';

function authHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function lanePath(lane: Lane): string {
  return lane === 'claim-status' ? 'claim-status' : 'eligibility';
}

function defaultEscalation(lane: Lane) {
  if (lane === 'claim-status') {
    return {
      exceptionType: 'ambiguous_payer_response',
      summary: 'Escalated from the CRM manager for manual payer follow-up.',
      recommendedHumanAction: 'Review the payer response and complete manual follow-up.',
      severity: 'high',
    };
  }

  return {
    exceptionType: 'payer_system_unavailable',
    summary: 'Escalated from the CRM manager for manual eligibility verification.',
    recommendedHumanAction: 'Verify eligibility manually with the payer before closing the case.',
    severity: 'high',
  };
}

function buildActionRequest(
  lane: Lane,
  operation: Operation,
  workItemId: string,
  body: Record<string, unknown>,
) {
  const laneSegment = lanePath(lane);
  const escalation = defaultEscalation(lane);

  switch (operation) {
    case 'run-primary':
      return {
        path: `/api/rcm/lanes/${laneSegment}/work-items/${workItemId}/run-primary`,
        body:
          lane === 'claim-status'
            ? {
                connectorKey: 'x12_276_277',
                playbookVersion: 'claim_status_v1',
                strategy: 'dashboard_primary_run',
                qaActorRef: 'dashboard_manager',
                autoRoute: true,
              }
            : {
                connectorKey: 'x12_270_271',
                playbookVersion: 'eligibility_v1',
                strategy: 'dashboard_primary_run',
                qaActorRef: 'dashboard_manager',
                autoRoute: true,
              },
        successMessage: 'Primary connector run submitted.',
      };
    case 'run-fallback':
      return {
        path: `/api/rcm/lanes/${laneSegment}/work-items/${workItemId}/run-fallback`,
        body:
          lane === 'claim-status'
            ? {
                connectorKey: 'dde',
                playbookVersion: 'claim_status_v1',
                alternativeStrategy: 'dashboard_fallback_dde',
                qaActorRef: 'dashboard_manager',
                autoRoute: true,
              }
            : {
                connectorKey: 'portal',
                playbookVersion: 'eligibility_v1',
                alternativeStrategy: 'dashboard_fallback_portal',
                qaActorRef: 'dashboard_manager',
                autoRoute: true,
              },
        successMessage: 'Fallback connector run submitted.',
      };
    case 'approve-qa':
      return {
        path: `/api/rcm/lanes/${laneSegment}/work-items/${workItemId}/verify`,
        body: {
          qaDecision: 'approve_auto_close',
          qaReasonCode: 'dashboard_manager_approved',
          notes: 'Approved from the CRM manager.',
        },
        successMessage: 'Case approved and closed.',
      };
    case 'escalate-qa':
      return {
        path: `/api/rcm/lanes/${laneSegment}/work-items/${workItemId}/verify`,
        body: {
          qaDecision: 'escalate',
          qaReasonCode: 'dashboard_manager_escalated',
          exceptionType:
            typeof body.exceptionType === 'string' && body.exceptionType.trim()
              ? body.exceptionType.trim()
              : escalation.exceptionType,
          summary:
            typeof body.summary === 'string' && body.summary.trim()
              ? body.summary.trim()
              : escalation.summary,
          recommendedHumanAction:
            typeof body.recommendedHumanAction === 'string' && body.recommendedHumanAction.trim()
              ? body.recommendedHumanAction.trim()
              : escalation.recommendedHumanAction,
          severity:
            typeof body.severity === 'string' && body.severity.trim()
              ? body.severity.trim()
              : escalation.severity,
          notes: 'Escalated from the CRM manager.',
        },
        successMessage: 'Case escalated to the human review queue.',
      };
    case 'take-over':
      return {
        path: `/api/rcm/lanes/${laneSegment}/work-items/${workItemId}/resolve`,
        body: {
          action: 'take_over_case',
          reviewerRef: 'dashboard_manager',
          summary:
            typeof body.summary === 'string' && body.summary.trim()
              ? body.summary.trim()
              : 'Taken over from the CRM manager.',
        },
        successMessage: 'Case moved into manual ownership.',
      };
    case 'mark-blocked':
      return {
        path: `/api/rcm/lanes/${laneSegment}/work-items/${workItemId}/resolve`,
        body: {
          action: 'mark_blocked',
          reviewerRef: 'dashboard_manager',
          summary:
            typeof body.summary === 'string' && body.summary.trim()
              ? body.summary.trim()
              : 'Blocked from the CRM manager pending manual follow-up.',
        },
        successMessage: 'Case marked blocked.',
      };
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    lane?: unknown;
    operation?: unknown;
    workItemId?: unknown;
    summary?: unknown;
    exceptionType?: unknown;
    recommendedHumanAction?: unknown;
    severity?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const lane = body.lane;
  const operation = body.operation;
  const workItemId = body.workItemId;

  if (lane !== 'claim-status' && lane !== 'eligibility') {
    return NextResponse.json({ error: 'lane must be "claim-status" or "eligibility"' }, { status: 400 });
  }

  if (
    operation !== 'run-primary' &&
    operation !== 'run-fallback' &&
    operation !== 'approve-qa' &&
    operation !== 'escalate-qa' &&
    operation !== 'take-over' &&
    operation !== 'mark-blocked'
  ) {
    return NextResponse.json({ error: 'Unsupported CRM action' }, { status: 400 });
  }

  if (typeof workItemId !== 'string' || !workItemId.trim()) {
    return NextResponse.json({ error: 'workItemId is required' }, { status: 400 });
  }

  const actionRequest = buildActionRequest(lane, operation, workItemId.trim(), body as Record<string, unknown>);
  if (!actionRequest) {
    return NextResponse.json({ error: 'Unsupported CRM action' }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}${actionRequest.path}`, {
      method: 'POST',
      headers: authHeaders(session.apiKey),
      body: JSON.stringify(actionRequest.body),
    });
    const data = await res.json().catch(() => ({}));

    return NextResponse.json(
      {
        ...data,
        message: res.ok ? actionRequest.successMessage : data.error ?? 'CRM action failed',
      },
      { status: res.status },
    );
  } catch {
    return NextResponse.json({ error: 'Failed to execute CRM action' }, { status: 502 });
  }
}
