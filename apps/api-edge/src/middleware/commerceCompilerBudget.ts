import type { Context, MiddlewareHandler } from 'hono';

import type { Env, Variables } from '../types';

const CONSUMER_KEY_PATTERN = /^[a-f0-9]{64}$/;

function clientNetwork(request: Request): string {
  return request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function modelBillingEnabled(env: Env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

type AgentPayContext = Context<{ Bindings: Env; Variables: Variables }>;

function unavailableResponse(c: AgentPayContext) {
  c.header('Retry-After', '60');
  c.header('X-AgentPay-Rate-Control', 'unavailable');
  return c.json({
    error: 'COMMERCE_RATE_CONTROL_UNAVAILABLE',
    message: 'Commerce compilation is temporarily unavailable',
  }, 503);
}

function limitedResponse(
  c: AgentPayContext,
  scope: 'shopper' | 'merchant',
) {
  c.header('Retry-After', '60');
  c.header('X-AgentPay-Rate-Control', 'isolate+cloudflare');
  c.header('X-AgentPay-Rate-Scope', scope);
  return c.json({
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Commerce compilation capacity reached. Retry after 60s.',
  }, 429);
}

/**
 * Adds cost controls after API-key authentication, before any model call.
 * Cloudflare counters are deliberately layered with the isolate-local limiter:
 * neither mechanism is an accounting ledger, but together they contain bursts
 * across Worker isolates while a provider-side budget remains the hard ceiling.
 */
export const commerceCompilerBudgetMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const shopperLimiter = c.env.COMMERCE_COMPILER_SHOPPER_LIMITER;
  const merchantLimiter = c.env.COMMERCE_COMPILER_MERCHANT_LIMITER;

  if (!shopperLimiter || !merchantLimiter) {
    if (modelBillingEnabled(c.env)) return unavailableResponse(c);
    c.header('X-AgentPay-Rate-Control', 'isolate');
    return next();
  }

  const merchant = c.get('merchant');
  const suppliedConsumerKey = c.req.header('X-AgentPay-Consumer-Key')?.toLowerCase();
  const consumerKey = suppliedConsumerKey && CONSUMER_KEY_PATTERN.test(suppliedConsumerKey)
    ? `consumer:${suppliedConsumerKey}`
    : `network:${clientNetwork(c.req.raw)}`;

  try {
    const [shopperResult, merchantResult] = await Promise.all([
      shopperLimiter.limit({ key: await sha256(`merchant:${merchant.id}:${consumerKey}`) }),
      merchantLimiter.limit({ key: await sha256(`merchant:${merchant.id}`) }),
    ]);

    if (!merchantResult.success) return limitedResponse(c, 'merchant');
    if (!shopperResult.success) return limitedResponse(c, 'shopper');
    c.header('X-AgentPay-Rate-Control', 'isolate+cloudflare');
    return next();
  } catch {
    if (modelBillingEnabled(c.env)) return unavailableResponse(c);
    c.header('X-AgentPay-Rate-Control', 'isolate');
    return next();
  }
};
