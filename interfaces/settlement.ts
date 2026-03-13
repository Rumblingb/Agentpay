// Settlement request/response contracts shared across the split
export interface SettlementRequest {
  intentId: string;
  amount: number;
  currency: string;
  fromAgentId: string;
  toAgentId: string;
}

export interface SettlementResponse {
  success: boolean;
  settlementId?: string;
  reason?: string;
}
