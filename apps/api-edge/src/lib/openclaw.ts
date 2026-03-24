/**
 * OpenClaw dispatch helper.
 *
 * Called automatically from the Stripe webhook handler after
 * checkout.session.completed confirms payment on a Bro booking job.
 *
 * Only runs when OPENCLAW_API_URL + OPENCLAW_API_KEY are set.
 * Safe to call fire-and-forget — logs outcome to CF Tail.
 */

import type { Env } from '../types';

function broLog(event: string, data: Record<string, unknown>) {
  console.info(JSON.stringify({ bro: true, event, ...data }));
}

export interface OpenClawPayload {
  jobId: string;
  /** Train details extracted from job metadata */
  route: string;
  fromStation: string;
  toStation: string;
  departureDate: string;
  departureTime?: string;
  operator?: string;
  trainClass?: string;
  passengers: {
    legalName: string;
    email: string;
    phone?: string;
  }[];
  fareGbp?: number;
  fareInr?: number;
  nationality: 'uk' | 'india';
  /** The job's internal metadata — OpenClaw may use fields we don't enumerate */
  rawMetadata: Record<string, unknown>;
}

export interface OpenClawResult {
  status: 'dispatched' | 'failed';
  openclawJobId?: string;
  error?: string;
  dispatchedAt: string;
}

/**
 * Build an OpenClaw payload from AgentPay job metadata.
 * The metadata shape comes from buildJobDescription in concierge.ts.
 */
function buildPayload(jobId: string, metadata: Record<string, unknown>): OpenClawPayload {
  const profile = (metadata.travelProfile as Record<string, unknown>) ?? {};
  const plan    = (metadata.plan as Record<string, unknown>[]) ?? [];
  const first   = plan[0] ?? {};
  const skills  = (first.skills as Record<string, unknown>[]) ?? [];
  const skill   = skills[0] ?? {};
  const params  = (skill.parameters as Record<string, unknown>) ?? {};

  return {
    jobId,
    route: `${params.fromStation ?? ''} → ${params.toStation ?? ''}`,
    fromStation: String(params.fromStation ?? ''),
    toStation:   String(params.toStation ?? ''),
    departureDate: String(params.travelDate ?? params.departureDate ?? ''),
    departureTime: params.departureTime ? String(params.departureTime) : undefined,
    operator:    params.operator    ? String(params.operator)    : undefined,
    trainClass:  params.trainClass  ? String(params.trainClass)  : undefined,
    passengers: [{
      legalName: String(profile.legalName ?? metadata.legalName ?? ''),
      email:     String(profile.email     ?? metadata.email     ?? ''),
      phone:     profile.phone ? String(profile.phone) : undefined,
    }],
    fareGbp: params.fareGbp ? Number(params.fareGbp) : undefined,
    fareInr: params.fareInr ? Number(params.fareInr) : undefined,
    nationality: (profile.nationality === 'india' ? 'india' : 'uk') as 'uk' | 'india',
    rawMetadata: metadata,
  };
}

/**
 * Dispatch a confirmed booking to OpenClaw.
 * Returns the dispatch result — caller should save this to job metadata.
 */
export async function dispatchToOpenClaw(
  env: Env,
  jobId: string,
  metadata: Record<string, unknown>,
): Promise<OpenClawResult> {
  const now = new Date().toISOString();

  if (!env.OPENCLAW_API_URL || !env.OPENCLAW_API_KEY) {
    broLog('openclaw_skipped', { jobId, reason: 'OPENCLAW_API_URL or OPENCLAW_API_KEY not set' });
    return { status: 'failed', error: 'OpenClaw not configured', dispatchedAt: now };
  }

  const payload = buildPayload(jobId, metadata);

  broLog('openclaw_dispatching', { jobId, route: payload.route, nationality: payload.nationality });

  try {
    const resp = await fetch(`${env.OPENCLAW_API_URL}/fulfill`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENCLAW_API_KEY}`,
        'Content-Type': 'application/json',
        'X-AgentPay-Job-Id': jobId,
      },
      body: JSON.stringify(payload),
    });

    const body = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      broLog('openclaw_error', { jobId, status: resp.status, body });
      return {
        status: 'failed',
        error: `OpenClaw returned ${resp.status}: ${JSON.stringify(body)}`,
        dispatchedAt: now,
      };
    }

    const openclawJobId = String(body.jobId ?? body.id ?? body.reference ?? '');
    broLog('openclaw_dispatched', { jobId, openclawJobId, route: payload.route });

    return { status: 'dispatched', openclawJobId, dispatchedAt: now };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    broLog('openclaw_fetch_error', { jobId, error: msg });
    return { status: 'failed', error: msg, dispatchedAt: now };
  }
}
