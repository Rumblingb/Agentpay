import type { TravelPolicy, Operator, TripIntent } from '@ace/core'

export type PolicyDecision =
  | { mode: 'auto'; reason: string }
  | { mode: 'human_confirm'; reason: string }
  | { mode: 'escalate'; reason: string; code: string }

export interface PolicyEngine {
  canOperatorAct(operator: Operator, action: string, policy: TravelPolicy): boolean
  getApprovalRequirement(intent: TripIntent, policy: TravelPolicy): PolicyDecision
  canAutoBook(intent: TripIntent, policy: TravelPolicy): boolean
}
