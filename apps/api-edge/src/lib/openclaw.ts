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

type OpenClawMarket = 'uk' | 'india' | 'eu';

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
  nationality: OpenClawMarket;
  /** The job's internal metadata — OpenClaw may use fields we don't enumerate */
  rawMetadata: Record<string, unknown>;
}

export interface OpenClawResult {
  status: 'dispatched' | 'failed';
  openclawJobId?: string;
  error?: string;
  dispatchedAt: string;
}

export interface OpenClawEligibility {
  ok: boolean;
  reason?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstPlanParams(metadata: Record<string, unknown>): Record<string, unknown> {
  const plan = Array.isArray(metadata.plan) ? metadata.plan : [];
  const first = asRecord(plan[0]);
  const skills = Array.isArray(first.skills) ? first.skills : [];
  const firstSkill = asRecord(skills[0]);
  return asRecord(firstSkill.parameters);
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function deriveDepartureDate(
  td: Record<string, unknown>,
  proof: Record<string, unknown>,
  params: Record<string, unknown>,
): string {
  const departureDatetime = pickString(td.departureDatetime, proof.departureDatetime);
  if (departureDatetime) return departureDatetime.slice(0, 10);
  const explicitDate = pickString(td.travelDate, proof.travelDate, params.travelDate, params.departureDate);
  return explicitDate ? explicitDate.slice(0, 10) : '';
}

export function shouldDispatchToOpenClaw(metadata: Record<string, unknown>): OpenClawEligibility {
  if (metadata.pendingFulfilment !== true) {
    return { ok: false, reason: 'pendingFulfilment is not true' };
  }

  const td = asRecord(metadata.trainDetails);
  if (pickString(td.transportMode) === 'bus') {
    return { ok: false, reason: 'bus jobs are not eligible for OpenClaw' };
  }
  const params = firstPlanParams(metadata);
  const flightDetails = asRecord(metadata.flightDetails);
  const hasRailShape = !!pickString(td.origin, td.destination, params.fromStation, params.toStation, params.origin, params.destination);
  const hasFlightShape = !!pickString(flightDetails.origin, flightDetails.destination, params.originAirport, params.destinationAirport);

  if (hasFlightShape && !hasRailShape) {
    return { ok: false, reason: 'flight job is not eligible for OpenClaw' };
  }

  const market = pickString(td.country, asRecord(metadata.completionProof).country);
  if (market === 'eu') {
    return { ok: false, reason: 'eu jobs are not yet supported by OpenClaw dispatch' };
  }
  if (market === 'global') {
    return { ok: false, reason: 'global jobs are not eligible for OpenClaw dispatch' };
  }

  if (!hasRailShape) {
    return { ok: false, reason: 'missing rail details for OpenClaw dispatch' };
  }

  return { ok: true };
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
export function buildPayload(jobId: string, metadata: Record<string, unknown>): OpenClawPayload {
  const td = asRecord(metadata.trainDetails);
  const proof = asRecord(metadata.completionProof);
  const profile = asRecord(metadata.travelProfile);
  const params = firstPlanParams(metadata);

  const fromStation = pickString(td.origin, proof.fromStation, params.fromStation, params.origin) ?? '';
  const toStation = pickString(td.destination, proof.toStation, params.toStation, params.destination) ?? '';
  const departureDate = deriveDepartureDate(td, proof, params);
  const market = pickString(td.country, proof.country, profile.nationality) as OpenClawMarket | undefined;

  return {
    jobId,
    route: `${fromStation} → ${toStation}`,
    fromStation,
    toStation,
    departureDate,
    departureTime: pickString(td.departureTime, proof.departureTime, params.departureTime),
    operator:      pickString(td.operator, proof.operator, params.operator),
    trainClass:    pickString(td.classCode, params.trainClass),
    passengers: [{
      legalName: pickString(metadata.userName, metadata.legalName, profile.legalName) ?? '',
      email:     pickString(metadata.userEmail, metadata.email, profile.email) ?? '',
      phone:     pickString(metadata.userPhone, metadata.phone, profile.phone),
    }],
    fareGbp: pickNumber(td.estimatedFareGbp, proof.fareGbp, params.fareGbp),
    fareInr: pickNumber(td.fareInr, proof.fareInr, params.fareInr),
    nationality: market === 'india' ? 'india' : market === 'eu' ? 'eu' : 'uk',
    rawMetadata: metadata,
  };
}

export function validatePayload(payload: OpenClawPayload): string | null {
  if (!payload.fromStation) return 'Missing fromStation';
  if (!payload.toStation) return 'Missing toStation';
  if (!payload.departureDate) return 'Missing departureDate';
  if (!payload.passengers[0]?.legalName && !payload.passengers[0]?.email) {
    return 'Missing passenger identity';
  }
  return null;
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

  const eligibility = shouldDispatchToOpenClaw(metadata);
  if (!eligibility.ok) {
    broLog('openclaw_skipped', { jobId, reason: eligibility.reason ?? 'job not eligible' });
    return { status: 'failed', error: eligibility.reason ?? 'job not eligible', dispatchedAt: now };
  }

  const payload = buildPayload(jobId, metadata);
  const validationError = validatePayload(payload);
  if (validationError) {
    broLog('openclaw_validation_failed', { jobId, error: validationError, route: payload.route });
    return { status: 'failed', error: validationError, dispatchedAt: now };
  }

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
