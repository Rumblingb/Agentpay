import { createHmac } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { API_BASE } from '@/lib/api';
import { type Need, type ScopeMode } from '@/app/commerce/commerceCatalog';
import { buildCommerceCompilePayload } from './payload';

const NEEDS = new Set<Need>(['commute', 'small-space', 'unplug', 'gift']);
const SCOPES = new Set<ScopeMode>(['all', 'wear', 'home', 'audio']);

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set('cache-control', 'no-store');
  return response;
}

function validInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function shopperRateKey(request: NextRequest, secret: string): string {
  const network = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
  const utcDay = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', secret).update(`${utcDay}:${network}`).digest('hex');
}

export async function POST(request: NextRequest) {
  if (process.env.AGENTPAY_COMMERCE_DEMO_ENABLED !== 'true') {
    return noStoreJson({ error: 'Commerce compiler is not enabled' }, 503);
  }
  const apiKey = process.env.AGENTPAY_INTERNAL_API_KEY;
  if (!apiKey) return noStoreJson({ error: 'Commerce compiler is not configured' }, 503);
  const rateKeySecret = process.env.AGENTPAY_COMMERCE_RATE_KEY_SECRET;
  if (!rateKeySecret || rateKeySecret.length < 32) {
    return noStoreJson({ error: 'Commerce compiler rate control is not configured' }, 503);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return noStoreJson({ error: 'JSON content type required' }, 415);
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return noStoreJson({ error: 'Cross-origin request denied' }, 403);

  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_024) return noStoreJson({ error: 'Shopping brief is too large' }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError();
      body = parsed as Record<string, unknown>;
    } catch {
      return noStoreJson({ error: 'Valid JSON object required' }, 400);
    }
    if (typeof body.need !== 'string' || !NEEDS.has(body.need as Need)) {
      return noStoreJson({ error: 'Unsupported shopping need' }, 400);
    }
    if (typeof body.scopeMode !== 'string' || !SCOPES.has(body.scopeMode as ScopeMode)) {
      return noStoreJson({ error: 'Unsupported agent scope' }, 400);
    }
    if (!validInteger(body.budgetMinor, 4_000, 20_000)
      || !validInteger(body.maxDeliveryDays, 2, 5)
      || typeof body.easyReturns !== 'boolean') {
      return noStoreJson({ error: 'Invalid shopping brief' }, 400);
    }
    const need = body.need as Need;
    const scopeMode = body.scopeMode as ScopeMode;
    const catalogUpdatedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 14_000);
    try {
      const upstream = await fetch(`${API_BASE.replace(/\/+$/, '')}/api/commerce/compile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-AgentPay-Consumer-Key': shopperRateKey(request, rateKeySecret),
        },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(buildCommerceCompilePayload({
          need,
          scopeMode,
          budgetMinor: body.budgetMinor,
          maxDeliveryDays: body.maxDeliveryDays,
          easyReturns: body.easyReturns,
        }, catalogUpdatedAt)),
      });
      const result = await upstream.json().catch(() => null);
      if (!result || typeof result !== 'object') return noStoreJson({ error: 'Invalid compiler response' }, 502);
      return noStoreJson(result, upstream.status);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: unknown) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return noStoreJson({ error: timedOut ? 'Commerce compiler timed out' : 'Commerce compiler unavailable' }, 502);
  }
}
