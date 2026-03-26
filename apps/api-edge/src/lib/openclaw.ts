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
 *
 * Metadata shape (written by concierge.ts after hire):
 *   trainDetails  — { origin, destination, departureTime, departureDatetime,
 *                     estimatedFareGbp, fareInr, operator, classCode, country, ... }
 *   userEmail     — passenger email
 *   userName      — passenger display name
 *   userPhone     — passenger phone (optional)
 *   broRef        — internal booking reference
 */
function buildPayload(jobId: string, metadata: Record<string, unknown>): OpenClawPayload {
  const td = (metadata.trainDetails as Record<string, unknown>) ?? {};

  const fromStation = String(td.origin      ?? '');
  const toStation   = String(td.destination ?? '');

  // Parse date from departureDatetime (ISO) or departureTime string
  let departureDate = '';
  if (td.departureDatetime) {
    departureDate = String(td.departureDatetime).slice(0, 10); // YYYY-MM-DD
  }

  const country: 'uk' | 'india' = td.country === 'india' ? 'india' : 'uk';

  return {
    jobId,
    route: `${fromStation} → ${toStation}`,
    fromStation,
    toStation,
    departureDate,
    departureTime: td.departureTime  ? String(td.departureTime)  : undefined,
    operator:      td.operator       ? String(td.operator)       : undefined,
    trainClass:    td.classCode      ? String(td.classCode)      : undefined,
    passengers: [{
      legalName: String(metadata.userName  ?? ''),
      email:     String(metadata.userEmail ?? ''),
      phone:     metadata.userPhone ? String(metadata.userPhone) : undefined,
    }],
    fareGbp: td.estimatedFareGbp ? Number(td.estimatedFareGbp) : undefined,
    fareInr: td.fareInr          ? Number(td.fareInr)          : undefined,
    nationality: country,
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
