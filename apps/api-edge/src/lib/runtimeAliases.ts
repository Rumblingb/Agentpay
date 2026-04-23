/**
 * runtimeAliases.ts — environment-based runtime feature flags.
 */

import type { Env } from '../types';

export function isFulfillmentProviderConfigured(env: Env): boolean {
  return Boolean(env.OPENCLAW_API_URL && env.OPENCLAW_API_KEY);
}
