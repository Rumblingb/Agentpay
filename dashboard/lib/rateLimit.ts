import { NextRequest, NextResponse } from 'next/server';

type Bucket = { count: number; resetAt: number };
type RateLimitState = Map<string, Bucket>;

const globalState = globalThis as typeof globalThis & { __agentPayRateLimit?: RateLimitState };
const state = globalState.__agentPayRateLimit ?? new Map<string, Bucket>();
globalState.__agentPayRateLimit = state;

/**
 * Small per-instance burst guard for public credential/intake routes. This is
 * intentionally bounded and fail-open only when the process is unavailable;
 * production still needs a durable edge limiter before public release.
 */
export function enforceBurstLimit(
  request: NextRequest,
  route: string,
  limit = 10,
  windowMs = 60_000,
): Response | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `${route}:${address.slice(0, 128)}`;
  const now = Date.now();
  const current = state.get(key);

  if (!current || current.resetAt <= now) {
    state.set(key, { count: 1, resetAt: now + windowMs });
  } else if (current.count >= limit) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((current.resetAt - now) / 1000)) } },
    );
  } else {
    current.count += 1;
  }

  if (state.size > 10_000) {
    for (const [entryKey, bucket] of state) {
      if (bucket.resetAt <= now) state.delete(entryKey);
    }
  }

  return null;
}
