/**
 * fulfillmentMetadata.ts — patch helpers for enriching booking metadata
 * after OpenClaw fulfillment dispatch.
 */

import type { OpenClawResult } from './openclaw';

export function withFulfillmentDispatchPatch(
  result: OpenClawResult,
): Record<string, unknown> {
  return {
    fulfillmentProvider: 'openclaw',
    fulfillmentDispatchStatus: result.status,
    fulfillmentJobId: result.openclawJobId ?? null,
    fulfillmentDispatchedAt: new Date().toISOString(),
  };
}
