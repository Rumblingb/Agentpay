import { createSettlement } from '../adapters/settlement/settlementAdapter';
import type { SettlementRequest, SettlementResponse } from '../interfaces/settlement';

export async function settle(req: SettlementRequest): Promise<SettlementResponse> {
  return createSettlement(req);
}
